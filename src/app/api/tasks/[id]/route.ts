import { route } from "@/lib/api";
import { deleteTask, TaskPatch, updateTask } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const PATCH = route({ body: TaskPatch }, ({ params, body }) => ({ task: updateTask(params.id, body) }));
export const DELETE = route({}, ({ params, url }) => {
  deleteTask(params.id, url.searchParams.get("purge") === "1");
  return { ok: true };
});
