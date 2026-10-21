import { route } from "@/lib/api";
import { suggestTasks, SuggestInput } from "@/lib/task-suggestions";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
// Proposes tasks only; nothing is created until the user approves them in the UI (each one is then a normal POST /api/tasks).
export const POST = route({ body: SuggestInput }, ({ req, body }) => suggestTasks(body, req.signal));
