import { z } from "zod";
import { ApiError, json, route } from "@/lib/api";
import { CAPTURE_KINDS, createCapture, listCaptures } from "@/lib/captures";
import { readForm } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route({}, ({ url }) => {
  const p = url.searchParams;
  return {
    captures: listCaptures({
      status: p.get("status") || undefined,
      q: p.get("q") || undefined,
      kind: p.get("kind") || undefined,
      archived: p.get("archived") === "1",
    }),
  };
});

const JsonBody = z.object({
  kind: z.enum(CAPTURE_KINDS).optional(),
  content: z.string().max(200_000).optional(),
  url: z.string().max(2000).optional(),
  process: z.boolean().optional(),
});

export const POST = route({}, async ({ req }) => {
  const type = req.headers.get("content-type") ?? "";
  let input;
  if (type.startsWith("multipart/form-data")) {
    const { fields, files } = await readForm(req);
    const kind = CAPTURE_KINDS.find((k) => k === fields.kind);
    input = { kind, content: fields.content, url: fields.url, files, autoProcess: fields.process === "1" };
  } else if (type.startsWith("application/json")) {
    const raw = await req.json().catch(() => {
      throw new ApiError(400, "Invalid JSON", "bad_json");
    });
    const b = JsonBody.parse(raw);
    input = { kind: b.kind, content: b.content, url: b.url, autoProcess: b.process };
  } else throw new ApiError(415, "Unsupported content type", "unsupported");
  const r = await createCapture(input);
  return json(r, r.duplicate ? 200 : 201);
});
