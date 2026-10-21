import { ApiError, route } from "@/lib/api";
import { deleteConversation, getConversation } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ params }) => {
  const c = getConversation(params.id);
  if (!c) throw new ApiError(404, "Conversation not found", "not_found");
  return c;
});
export const DELETE = route({}, ({ params }) => {
  deleteConversation(params.id);
  return { ok: true };
});
