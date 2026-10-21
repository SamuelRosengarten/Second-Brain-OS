import { z } from "zod";
import { route } from "@/lib/api";
import { chatStream } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
const Body = z.object({
  message: z.string().trim().min(1).max(20_000),
  conversationId: z.string().optional(),
  model: z.string().max(100).optional(),
  useLibrary: z.boolean().default(false),
  noteIds: z.array(z.string()).max(50).optional(),
});
export const POST = route({ body: Body }, ({ req, body }) =>
  new Response(chatStream(body, req.signal), {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  }),
);
