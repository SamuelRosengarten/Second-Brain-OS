import { getConfig } from "./config.ts";
import { getDb, getSetting } from "./db.ts";
import { ApiError } from "./api.ts";
import { getProvider, OllamaError, type ChatMessage } from "./ollama.ts";
import { DEFAULT_CHAT_SYSTEM_PROMPT, groundedSystemPrompt } from "./prompts.ts";
import { search } from "./search.ts";
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
  const model = req.model || getChatModel();
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
      try {
        if (req.useLibrary) {
          const res = await search(req.message, { limit: 6, noteIds: req.noteIds });
          sources = res.hits.map((h, i) => ({
            n: i + 1, noteId: h.noteId, title: h.title, heading: h.heading, path: h.path, chunkIndex: h.chunkIndex, text: h.text.slice(0, 1500),
          }));
          controller.enqueue(line({ type: "meta", conversationId, grounded: true, sources, semantic: res.semantic, model }));
        } else {
          controller.enqueue(line({ type: "meta", conversationId, grounded: false, sources: [], model }));
        }
        const history = db
          .prepare("SELECT role, content FROM messages WHERE conversation_id = ? AND role <> 'system' ORDER BY id DESC LIMIT 20")
          .all(conversationId) as ChatMessage[];
        history.reverse();
        const system = req.useLibrary ? groundedSystemPrompt(getSystemPrompt(), sources) : getSystemPrompt();
        const messages: ChatMessage[] = [{ role: "system", content: system }, ...history];
        for await (const delta of getProvider().chatStream(model, messages, signal)) {
          answer += delta;
          controller.enqueue(line({ type: "delta", text: delta }));
        }
        controller.enqueue(line({ type: "done" }));
      } catch (e) {
        const err = e instanceof OllamaError ? { message: e.message, hint: e.hint, code: e.code } : { message: "The request was interrupted.", code: "error" };
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
