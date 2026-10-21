import { z } from "zod";
import { route } from "@/lib/api";
import { processCapture } from "@/lib/captures";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = route({ body: z.object({ model: z.string().max(100).optional() }) }, async ({ params, body }) => ({
  capture: await processCapture(params.id, body.model),
}));
