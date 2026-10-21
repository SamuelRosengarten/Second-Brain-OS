import { getDb } from "./db.ts";
import { getNote } from "./notes.ts";
import { search } from "./search.ts";

export interface NoteConnections {
  /** Notes whose text contains [[This note's title]]. */
  linkedFrom: { id: string; title: string; snippet: string }[];
  /** Tasks created from this note's capture, or that name the note in their description. */
  tasks: { id: string; title: string; due_date: string | null; status: string }[];
  /** Notes close in meaning (or in keywords when no embeddings exist yet). */
  similar: { id: string; title: string }[];
  semantic: boolean;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Text around the first occurrence of `needle`, trimmed to roughly one line. */
function around(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, " ");
  const i = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return flat.slice(0, 100);
  const from = Math.max(0, i - 40);
  const to = Math.min(flat.length, i + needle.length + 50);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}

export async function noteConnections(id: string): Promise<NoteConnections | null> {
  const note = getNote(id);
  if (!note) return null;
  const db = getDb();

  const wiki = `[[${note.title}]]`;
  const rows = db
    .prepare(
      `SELECT n.id, n.title, c.text FROM chunks c JOIN notes n ON n.id = c.note_id
       WHERE n.id <> ? AND c.text LIKE ? ESCAPE '\\' ORDER BY n.updated_at DESC LIMIT 40`,
    )
    .all(id, `%${escapeLike(wiki)}%`) as { id: string; title: string; text: string }[];
  const seen = new Set<string>();
  const linkedFrom = rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 8).map((r) => ({ id: r.id, title: r.title, snippet: around(r.text, wiki) }));

  const tasks = db
    .prepare(
      `SELECT id, title, due_date, status FROM tasks
       WHERE deleted_at IS NULL AND (capture_id IN (SELECT id FROM captures WHERE note_id = ?) OR description = ?)
       ORDER BY status = 'done', due_date IS NULL, due_date LIMIT 10`,
    )
    .all(id, `From note “${note.title}”`) as NoteConnections["tasks"];

  let similar: NoteConnections["similar"] = [];
  let semantic = false;
  try {
    const res = await search(`${note.title}. ${note.summary}`.slice(0, 300), { limit: 12 });
    semantic = res.semantic.used;
    const uniq = new Map<string, string>();
    for (const h of res.hits) if (h.noteId !== id && !uniq.has(h.noteId)) uniq.set(h.noteId, h.title);
    similar = [...uniq].slice(0, 3).map(([nid, title]) => ({ id: nid, title }));
  } catch {
    // no suggestions rather than an error: this panel is a convenience
  }
  return { linkedFrom, tasks, similar, semantic };
}
