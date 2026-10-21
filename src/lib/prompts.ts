import { z } from "zod";
import type { ChatMessage } from "./ollama.ts";

/** Structured proposal produced by the model for a capture. Always reviewed by the user before anything is saved. */
export const ProposalSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().max(1200),
  category: z.string().max(60),
  tags: z.array(z.string().max(40)).max(12),
  related_projects: z.array(z.string().max(120)).max(5),
  next_action: z.string().max(300),
  open_questions: z.array(z.string().max(300)).max(6),
  confidence: z.enum(["low", "medium", "high"]),
  uncertainty: z.string().max(400),
  note_markdown: z.string().max(20000),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const proposalJsonSchema = z.toJSONSchema(ProposalSchema) as object;

export const CAPTURE_SYSTEM_PROMPT = `You turn a raw capture (an idea, note, link, excerpt or task) into a structured proposal for a personal Markdown knowledge base.

Rules:
- Use ONLY information present in the capture. Never invent facts, names, dates, URLs or quotes.
- If something is unclear or missing, say so in "uncertainty" and list it under "open_questions". Do not guess.
- "title": concise, specific, no trailing punctuation, max ~80 characters.
- "summary": 1-3 sentences describing what the capture says (not your opinion).
- "category": one short lowercase word or phrase (e.g. idea, reference, meeting, project, learning, personal).
- "tags": 2-6 short lowercase tags, hyphenated, no '#'.
- "related_projects": ONLY names copied exactly from the provided project list that clearly relate. Otherwise [].
- "next_action": one concrete, small next step phrased as an imperative. Empty string if none is implied.
- "open_questions": genuine unanswered questions raised by the capture. [] if none.
- "confidence": "high" only if the capture is clear and self-contained; "low" if it is vague or very short.
- "note_markdown": a clean Markdown note body: start with a "## Summary" section, keep the user's original meaning, preserve any links, and add a "## Open questions" or "## Next action" section only if non-empty. Do not repeat the title as an H1.
- Write in the same language as the capture.
- Respond with a single JSON object matching the schema and nothing else.`;

export function buildCaptureMessages(input: { kind: string; content: string; url?: string; projectNames: string[] }): ChatMessage[] {
  const content = input.content.length > 12000 ? input.content.slice(0, 12000) + "\n[truncated]" : input.content;
  const user = [
    `Capture type: ${input.kind}`,
    input.url ? `URL: ${input.url}` : null,
    `Existing projects: ${input.projectNames.length ? input.projectNames.map((n) => JSON.stringify(n)).join(", ") : "(none)"}`,
    "",
    "--- CAPTURE START ---",
    content,
    "--- CAPTURE END ---",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return [
    { role: "system", content: CAPTURE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

export const DEFAULT_CHAT_SYSTEM_PROMPT =
  "You are the assistant inside Second Brain OS, a private personal knowledge system. Be concise and honest. Distinguish facts from your own inferences. If you do not know something, say so.";

export function groundedSystemPrompt(
  base: string,
  passages: { n: number; title: string; heading: string; text: string }[],
  workspace = "",
  today = "",
): string {
  const ws = workspace
    ? `

WORKSPACE (the user's live projects and tasks, read from their database${today ? `; today is ${today}` : ""}). This is authoritative for questions about projects, tasks, statuses, priorities and due dates; no citation is needed for it. "In progress" means status "in progress". If a project or task the user asks about is not listed here, say it is not in their workspace.

${workspace}`
    : "";
  if (!passages.length) {
    return `${base}${ws}

${workspace ? "No note passages were retrieved for this question. Answer project and task questions from the WORKSPACE above. If the question is about note content instead, say clearly that the library does not appear to contain enough evidence, and do not answer from invented library content." : "The user asked a question about their library but NO relevant passages were retrieved. Say clearly that the library does not appear to contain enough evidence, and do not answer from invented library content."} You may offer general knowledge only if you label it as not coming from their notes.`;
  }
  const ctx = passages
    .map((p) => `[${p.n}] "${p.title}"${p.heading ? ` › ${p.heading}` : ""}\n${p.text}`)
    .join("\n\n");
  return `${base}${ws}

For questions about their notes, answer using ONLY the numbered library passages below. Cite the passages you rely on inline like [1] or [2][3]. If the passages do not contain enough evidence to answer, say so plainly instead of guessing${workspace ? " (project and task questions are answered from the WORKSPACE instead, without citations)" : ""}. Do not cite a passage you did not use, and never claim to have searched anything beyond these passages${workspace ? " and the WORKSPACE" : ""}.

LIBRARY PASSAGES:
${ctx}`;
}

/** Reusable template for turning an idea into a Markdown knowledge note (also shown in the UI for copy/paste use with any model). */
export const IDEA_TO_NOTE_TEMPLATE = `You are helping me turn a rough idea into a Markdown knowledge note.

Idea (verbatim):
"""
{{idea}}
"""

Produce a note with exactly these sections:
# <specific title>
## Summary            (1-3 sentences; only what the idea states)
## Why it matters     (only if the idea says so; otherwise write "Not stated")
## Details            (bullets preserving every concrete detail, link and name)
## Open questions     (things that are unclear or missing)
## Next action        (one small concrete step, or "None")
Tags: <3-6 lowercase hyphenated tags>

Do not add facts that are not in the idea. Flag uncertainty explicitly.`;
