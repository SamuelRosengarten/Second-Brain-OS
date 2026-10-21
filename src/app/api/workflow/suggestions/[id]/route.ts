import { z } from "zod";
import { route } from "@/lib/api";
import { resolveSuggestion } from "@/lib/workflow";

export const dynamic = "force-dynamic";
export const POST = route({ body: z.object({ action: z.enum(["accept", "dismiss"]) }) }, ({ params, body }) => {
  resolveSuggestion(params.id, body.action);
  return { ok: true };
});
