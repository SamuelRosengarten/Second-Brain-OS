import { ApiError } from "./api.ts";
import { getNote } from "./notes.ts";
import { getProject, projectDetail } from "./projects.ts";

/**
 * Builds a Markdown "context package" for the user to review and paste into Claude themselves.
 * Nothing is transmitted anywhere by the app; the user explicitly copies/downloads the result.
 */
export function buildContextPackage(input: { noteIds: string[]; projectId?: string; question: string }): { markdown: string; included: { id: string; title: string }[]; chars: number } {
  const included: { id: string; title: string }[] = [];
  const sections: string[] = [];
  const ids = new Set(input.noteIds);

  if (input.projectId) {
    const d = projectDetail(input.projectId);
    if (!d || !getProject(input.projectId)) throw new ApiError(404, "Project not found", "not_found");
    const p = d.project;
    sections.push(
      `## Project: ${p.name}\n\n- Status: ${p.status}${p.target_date ? `\n- Target date: ${p.target_date}` : ""}\n${p.description ? `\n${p.description}\n` : ""}${p.goals ? `\n**Goals**\n\n${p.goals}\n` : ""}` +
        (d.tasks.length ? `\n**Tasks**\n\n${d.tasks.map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title}${t.due_date ? ` (due ${t.due_date})` : ""} — ${t.priority}`).join("\n")}\n` : ""),
    );
    for (const n of d.notes as { id: string }[]) ids.add(n.id);
  }
  for (const id of ids) {
    const n = getNote(id);
    if (!n || n.fileMissing) continue;
    included.push({ id: n.id, title: n.title });
    sections.push(`## Note: ${n.title}\n\n_Source: ${n.sourceRef || n.sourceType}${n.tags.length ? ` · Tags: ${n.tags.join(", ")}` : ""}_\n\n${n.body.trim()}`);
  }
  if (!sections.length) throw new ApiError(400, "Select at least one note or a project.", "validation");

  const markdown = `# Context package from Second Brain OS

I am sharing the following notes from my personal knowledge base. Treat them as the only source of truth about my situation; if something is not covered, say so rather than guessing.

---

${sections.join("\n\n---\n\n")}

---

## My question

${input.question.trim() || "(write your question here)"}
`;
  return { markdown, included, chars: markdown.length };
}
