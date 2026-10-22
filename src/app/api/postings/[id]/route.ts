import { z } from "zod";
import { route } from "@/lib/api";
import { acceptPosting, archivePosting, deletePosting, PostingPatch, updatePosting } from "@/lib/scout";

export const dynamic = "force-dynamic";
const Decision = z.object({ action: z.enum(["accept", "deny", "save"]), draft: z.string().max(5000).optional() }).strict();

export const PATCH = route({ body: PostingPatch }, ({ params, body }) => ({ posting: updatePosting(params.id, body) }));
// accept: keep it, store the email and archive a copy; deny: remove it for good; save: take it off the list, keep the archived copy.
export const POST = route({ body: Decision }, ({ params, body }) => {
  if (body.action === "accept") return { posting: acceptPosting(params.id, body.draft ?? "") };
  if (body.action === "save") archivePosting(params.id);
  else deletePosting(params.id);
  return { ok: true };
});
export const DELETE = route({}, ({ params }) => {
  deletePosting(params.id);
  return { ok: true };
});
