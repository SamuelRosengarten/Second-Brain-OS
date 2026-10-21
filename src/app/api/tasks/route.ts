import { route } from "@/lib/api";
import { isYmd } from "@/lib/dates";
import { createTask, listTasks, listTrash, TaskInput } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ url }) => {
  const p = url.searchParams;
  const due = p.get("due");
  const today = p.get("today");
  if (p.get("trash") === "1") return { tasks: listTrash() };
  return {
    tasks: listTasks({
      status: p.get("status") || undefined,
      priority: p.get("priority") || undefined,
      project_id: p.get("project") || undefined,
      due: due === "overdue" || due === "today" || due === "soon" ? due : undefined,
      today: isYmd(today) ? today : undefined,
      dueFrom: isYmd(p.get("due_from")) ? p.get("due_from")! : undefined,
      dueTo: isYmd(p.get("due_to")) ? p.get("due_to")! : undefined,
      completedSince: /^\d{4}-\d{2}-\d{2}T/.test(p.get("completed_since") ?? "") ? p.get("completed_since")! : undefined,
      limit: Number(p.get("limit")) > 0 ? Number(p.get("limit")) : undefined,
    }),
  };
});
export const POST = route({ body: TaskInput }, ({ body }) => ({ task: createTask(body) }));
