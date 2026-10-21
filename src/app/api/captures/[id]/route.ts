import { ApiError, route } from "@/lib/api";
import { CapturePatch, deleteCapture, getCapture, updateCapture } from "@/lib/captures";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ params }) => {
  const c = getCapture(params.id);
  if (!c) throw new ApiError(404, "Capture not found", "not_found");
  return { capture: c };
});
export const PATCH = route({ body: CapturePatch }, ({ params, body }) => ({ capture: updateCapture(params.id, body) }));
export const DELETE = route({}, ({ params }) => {
  deleteCapture(params.id);
  return { ok: true };
});
