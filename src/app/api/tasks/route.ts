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
    }),
  };
});
export const POST = route({ body: TaskInput }, ({ body }) => ({ task: createTask(body) }));
