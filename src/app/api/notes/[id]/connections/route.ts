import { ApiError, route } from "@/lib/api";
import { noteConnections } from "@/lib/note-connections";

export const dynamic = "force-dynamic";
export const GET = route({}, async ({ params }) => {
  const c = await noteConnections(params.id);
  if (!c) throw new ApiError(404, "Note not found", "not_found");
  return c;
});
