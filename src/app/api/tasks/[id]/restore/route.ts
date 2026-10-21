import { route } from "@/lib/api";
import { restoreTask } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const POST = route({}, ({ params }) => ({ task: restoreTask(params.id) }));
