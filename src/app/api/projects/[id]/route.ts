import { z } from "zod";
import { ApiError, route } from "@/lib/api";
import { deleteProject, linkNote, ProjectPatch, projectDetail, unlinkNote, updateProject } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ params }) => {
  const d = projectDetail(params.id);
  if (!d) throw new ApiError(404, "Project not found", "not_found");
  return d;
});
export const PATCH = route({ body: ProjectPatch }, ({ params, body }) => ({ project: updateProject(params.id, body) }));
export const DELETE = route({}, ({ params }) => {
  deleteProject(params.id);
  return { ok: true };
});
const NoteLink = z.object({ note_id: z.string().min(1), action: z.enum(["link", "unlink"]).default("link") });
export const PUT = route({ body: NoteLink }, ({ params, body }) => {
  if (body.action === "link") linkNote(params.id, body.note_id);
  else unlinkNote(params.id, body.note_id);
  return projectDetail(params.id);
});
