import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { deleteNote, getNote, updateNote } from "@/lib/notes";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ params }) => {
  const note = getNote(params.id);
  if (!note) throw new ApiError(404, "Note not found", "not_found");
  const projects = getDb().prepare("SELECT p.id, p.name FROM project_notes pn JOIN projects p ON p.id = pn.project_id WHERE pn.note_id = ?").all(params.id);
  return { note, projects };
});
export const PATCH = route(
  {
    body: z.object({
      title: z.string().trim().min(1).max(200).optional(),
      body: z.string().max(500_000).optional(),
      tags: z.array(z.string()).max(20).optional(),
      category: z.string().max(60).optional(),
      summary: z.string().max(2000).optional(),
    }),
  },
  ({ params, body }) => ({ note: updateNote(params.id, body) }),
);
export const DELETE = route({}, ({ params }) => {
  deleteNote(params.id);
  return { ok: true };
});
