import { getConfig } from "./config.ts";
import { getDb, getSetting } from "./db.ts";
import { ApiError } from "./api.ts";
import { getProvider, OllamaError, type ChatMessage } from "./ollama.ts";
import { DEFAULT_CHAT_SYSTEM_PROMPT, groundedSystemPrompt } from "./prompts.ts";
import { search } from "./search.ts";
import { buildWorkspaceContext } from "./workspace-context.ts";
import { ymd } from "./dates.ts";
import { log, newId, nowIso } from "./util.ts";

export interface Source { n: number; noteId: string; title: string; heading: string; path: string; chunkIndex: number; text: string }
export interface StoredMessage { id: number; role: "user" | "assistant" | "system"; content: string; sources: Source[] | null; created_at: string }

export const getChatModel = (): string => getSetting("chat_model") || getConfig().chatModel;
export const getSystemPrompt = (): string => getSetting("system_prompt") || DEFAULT_CHAT_SYSTEM_PROMPT;

export function listConversations(): { id: string; title: string; model: string; updated_at: string }[] {
  return getDb().prepare("SELECT id, title, model, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 200").all() as never;
}

export function getConversation(id: string) {
  const db = getDb();
  const conv = db.prepare("SELECT id, title, model, created_at, updated_at FROM conversations WHERE id = ?").get(id);
  if (!conv) return null;
  const rows = db.prepare("SELECT id, role, content, sources_json, created_at FROM messages WHERE conversation_id = ? ORDER BY id").all(id) as {
    id: number; role: StoredMessage["role"]; content: string; sources_json: string | null; created_at: string;
  }[];
  const messages: StoredMessage[] = rows.map((r) => ({
    id: r.id, role: r.role, content: r.content, created_at: r.created_at,
    sources: r.sources_json ? (JSON.parse(r.sources_json) as Source[]) : null,
  }));
  return { ...(conv as object), messages };
}

export function deleteConversation(id: string): void {
  const r = getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id);
  if (!r.changes) throw new ApiError(404, "Conversation not found", "not_found");
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  model?: string;
  useLibrary: boolean;
  noteIds?: string[];
  /** "web" answers with Anthropic's web search and never sends your notes, tasks or projects. */
  mode?: "local" | "web";
}

export const WEB_MODEL = "claude-sonnet-5-5";
export const WEB_CONTEXT_TOKENS = 200_000;
const WEB_SYSTEM_PROMPT = "You are a research assistant with web search. Search when the question needs current or external facts, answer concisely, and say when you could not find something. You have no access to the user's private notes or tasks.";

/** Streams a web-searched answer from Claude. Yields text deltas, then a markdown list of the pages cited. */
async function* webChatStream(history: ChatMessage[], onUsage: (tokens: number) => void, signal?: AbortSignal): AsyncGenerator<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new ApiError(400, "ANTHROPIC_API_KEY is not set (put it in .env.local) - needed for web search.", "web_config");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const stream = client.messages.stream(
    {
      model: WEB_MODEL, max_tokens: 4096, system: WEB_SYSTEM_PROMPT,
      messages: history.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    },
    { signal },
  );
  const cited = new Map<string, string>();
  for await (const ev of stream) {
    if (ev.type === "content_block_delta") {
      if (ev.delta.type === "text_delta") yield ev.delta.text;
      else if (ev.delta.type === "citations_delta" && ev.delta.citation.type === "web_search_result_location") cited.set(ev.delta.citation.url, ev.delta.citation.title ?? ev.delta.citation.url);
    }
  }
  const u = (await stream.finalMessage()).usage;
  onUsage(u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + u.output_tokens);
  if (cited.size) {
    const links = [...cited].map(([url, title]) => `- [${title.replace(/[[\]]/g, "")}](${url})`);
    yield `\n\n**Sources**\n${links.join("\n")}`;
  }
}

const enc = new TextEncoder();
const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");

/**
 * Streams NDJSON events: meta -> delta* -> done | error.
 * The user's message is persisted before the model is called; the assistant message is persisted
 * on completion (and on partial output if the stream breaks).
 */
export function chatStream(req: ChatRequest, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const db = getDb();
  const web = req.mode === "web";
  const model = web ? WEB_MODEL : req.model || getChatModel();
  const now = nowIso();
  let convId = req.conversationId;
  if (convId) {
    if (!db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(convId)) throw new ApiError(404, "Conversation not found", "not_found");
  } else {
    convId = newId();
    const title = req.message.trim().replace(/\s+/g, " ").slice(0, 60);
    db.prepare("INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?,?,?,?,?)").run(convId, title, model, now, now);
  }
  const conversationId = convId;
  db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', ?, ?)").run(conversationId, req.message, now);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let sources: Source[] = [];
      let workspace = { text: "", projects: 0, tasks: 0 };
      try {
        if (web) {
          controller.enqueue(line({ type: "meta", conversationId, grounded: false, sources: [], model, web: true }));
        } else if (req.useLibrary) {
          const res = await search(req.message, { limit: 6, noteIds: req.noteIds });
          sources = res.hits.map((h, i) => ({
            n: i + 1, noteId: h.noteId, title: h.title, heading: h.heading, path: h.path, chunkIndex: h.chunkIndex, text: h.text.slice(0, 1500),
          }));
          workspace = buildWorkspaceContext(req.message);
          controller.enqueue(line({ type: "meta", conversationId, grounded: true, sources, semantic: res.semantic, model, workspace: { projects: workspace.projects, tasks: workspace.tasks } }));
        } else {
          controller.enqueue(line({ type: "meta", conversationId, grounded: false, sources: [], model }));
        }
        const history = db
          .prepare("SELECT role, content FROM messages WHERE conversation_id = ? AND role <> 'system' ORDER BY id DESC LIMIT 20")
          .all(conversationId) as ChatMessage[];
        history.reverse();
        const system = req.useLibrary ? groundedSystemPrompt(getSystemPrompt(), sources, workspace.text, ymd()) : getSystemPrompt();
        const messages: ChatMessage[] = [{ role: "system", content: system }, ...history];
        for await (const delta of web ? webChatStream(history, (used) => controller.enqueue(line({ type: "usage", used, max: WEB_CONTEXT_TOKENS })), signal) : getProvider().chatStream(model, messages, signal)) {
          answer += delta;
          controller.enqueue(line({ type: "delta", text: delta }));
        }
        controller.enqueue(line({ type: "done" }));
      } catch (e) {
        const err = e instanceof ApiError ? { message: e.message, code: e.code } : e instanceof OllamaError ? { message: e.message, hint: e.hint, code: e.code } : { message: "The request was interrupted.", code: "error" };
        if (!(e instanceof OllamaError)) log("warn", "chat.stream_failed", { message: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
        try { controller.enqueue(line({ type: "error", ...err })); } catch { /* client gone */ }
      } finally {
        if (answer.trim()) {
          db.prepare("INSERT INTO messages (conversation_id, role, content, sources_json, created_at) VALUES (?, 'assistant', ?, ?, ?)").run(
            conversationId, answer, sources.length ? JSON.stringify(sources) : null, nowIso(),
          );
        }
        db.prepare("UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?").run(nowIso(), model, conversationId);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
}
