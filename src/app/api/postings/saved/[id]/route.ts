import { route } from "@/lib/api";
import { deleteSaved } from "@/lib/scout";

export const dynamic = "force-dynamic";
export const DELETE = route({}, ({ params }) => {
  deleteSaved(params.id);
  return { ok: true };
});
