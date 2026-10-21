import { z } from "zod";
import { ApiError } from "./api.ts";
import { getChatModel } from "./chat.ts";
import { getDb } from "./db.ts";
import { isYmd, ymd } from "./dates.ts";
import { getProvider, type ChatMessage } from "./ollama.ts";
import { listProjects, listTasks } from "./projects.ts";
import { buildWorkspaceContext } from "./workspace-context.ts";

export const MAX_SUGGESTIONS = 8;

/** What the model is asked to return. Empty strings mean "none" (simpler for small models than nullable fields). */
const ModelOutput = z.object({
  tasks: z.array(z.object({
    title: z.string().max(300),
    description: z.string().max(1000),
    priority: z.enum(["low", "medium", "high"]),
    due_date: z.string().max(10),
    project: z.string().max(200),
  })).max(20),
});
const modelSchema = z.toJSONSchema(ModelOutput) as object;

export interface TaskSuggestion {
  title: string; description: string; priority: "low" | "medium" | "high"; due_date: string | null; project_id: string | null; project_name: string | null;
}
export interface SuggestResult { suggestions: TaskSuggestion[]; skippedDuplicates: number }

export const SuggestInput = z.object({
  request: z.string().trim().min(1).max(2000),
  conversationId: z.string().optional(),
  projectId: z.string().optional(),
  model: z.string().max(100).optional(),
  today: z.string().optional(),
});

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const STOP = new Set(["the", "and", "for", "with", "your", "you", "from", "that", "this", "into", "about", "each", "then", "also", "are", "all", "any", "out", "off"]);
const wordsOf = (s: string): Set<string> =>
  new Set(
    s.toLowerCase().split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2 && !STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );

/**
 * True when two task titles say (nearly) the same thing, so a reworded copy of an existing task is not suggested again.
 * Overlap coefficient on word sets (shared / size of the shorter title) with a floor of 3 shared words.
 */
export function similarTitles(a: string, b: string): boolean {
  if (norm(a) && norm(a) === norm(b)) return true;
  const A = wordsOf(a);
  const B = wordsOf(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared >= 3 && shared / Math.min(A.size, B.size) >= 0.6;
}

/**
 * Asks the local model to PROPOSE tasks. Nothing is saved here: the caller shows the list and the user decides.
 * Model output is never trusted: titles are trimmed, duplicates of open tasks dropped, projects must exist, dates must be real and not in the past.
 */
export async function suggestTasks(input: z.infer<typeof SuggestInput>, signal?: AbortSignal): Promise<SuggestResult> {
  const today = isYmd(input.today) ? input.today : ymd();
  const projects = listProjects().filter((p) => p.status !== "archived");
  const forced = input.projectId ? projects.find((p) => p.id === input.projectId) : undefined;
  if (input.projectId && !forced) throw new ApiError(400, "Unknown project", "validation");

  let recent = "";
  if (input.conversationId) {
    const rows = getDb()
      .prepare("SELECT role, content FROM messages WHERE conversation_id = ? AND role <> 'system' ORDER BY id DESC LIMIT 6")
      .all(input.conversationId) as { role: string; content: string }[];
    recent = rows.reverse().map((r) => `${r.role === "user" ? "User" : "Assistant"}: ${r.content.slice(0, 1200)}`).join("\n\n");
  }
  const workspace = buildWorkspaceContext(input.request, today).text;
  const system = `You help the user plan work in their personal task system. Propose between 1 and ${MAX_SUGGESTIONS} concrete, actionable tasks that follow from the request.
Rules:
- Each title starts with a verb, is specific, and is at most 100 characters.
- "priority" is low, medium or high.
- "due_date" is YYYY-MM-DD and must be on or after ${today}. Use "" unless the request or conversation implies a deadline.
- "project" must be EXACTLY one of the project names below, or "" if none fits${forced ? `. Use "${forced.name}" for every task` : ""}.
- Propose ONLY tasks that are missing. Never restate, reword or split a task that already exists in the workspace below; if the workspace already covers the request, return a short list or an empty list.
- Do not invent facts about the user. If the request is too vague to produce useful tasks, return an empty list.

Projects: ${projects.map((p) => `"${p.name}"`).join(", ") || "(none)"}
Today is ${today}.${workspace ? `\n\nEXISTING WORKSPACE:\n${workspace}` : ""}${recent ? `\n\nRECENT CONVERSATION:\n${recent}` : ""}`;
  const messages: ChatMessage[] = [{ role: "system", content: system }, { role: "user", content: input.request }];

  const raw = await getProvider().chatJson(input.model || getChatModel(), messages, modelSchema, signal);
  const parsed = ModelOutput.safeParse(raw);
  if (!parsed.success) throw new ApiError(502, "The model returned suggestions in an unexpected format. Try again.", "bad_model_output");

  const byName = new Map(projects.map((p) => [norm(p.name), p]));
  const existing = listTasks({ limit: 500 }).filter((t) => t.status !== "done").map((t) => t.title);
  const seen = new Set<string>();
  const suggestions: TaskSuggestion[] = [];
  let skippedDuplicates = 0;
  for (const t of parsed.data.tasks) {
    const title = t.title.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!title) continue;
    if (existing.some((e) => similarTitles(e, title)) || [...seen].some((e) => similarTitles(e, title))) { skippedDuplicates++; continue; }
    seen.add(title);
    const project = forced ?? byName.get(norm(t.project));
    suggestions.push({
      title,
      description: t.description.trim(),
      priority: t.priority,
      due_date: isYmd(t.due_date) && t.due_date >= today ? t.due_date : null,
      project_id: project?.id ?? null,
      project_name: project?.name ?? null,
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return { suggestions, skippedDuplicates };
}
