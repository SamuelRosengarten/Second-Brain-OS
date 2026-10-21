import { z } from "zod";
import { route } from "@/lib/api";
import { createNote, listNotes } from "@/lib/notes";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ url }) => {
  const p = url.searchParams;
  return {
    notes: listNotes({ q: p.get("q") || undefined, tag: p.get("tag") || undefined, category: p.get("category") || undefined, limit: Number(p.get("limit") || 100) }),
  };
});
const NoteBody = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(500_000).default(""),
  tags: z.array(z.string()).max(20).default([]),
  category: z.string().max(60).default(""),
  summary: z.string().max(2000).default(""),
  source_type: z.enum(["manual", "claude"]).default("manual"),
  source_ref: z.string().max(500).default(""),
});
export const POST = route({ body: NoteBody }, ({ body }) => ({
  note: createNote({
    title: body.title, body: body.body, tags: body.tags, category: body.category, summary: body.summary,
    sourceType: body.source_type, sourceRef: body.source_ref,
  }),
}));
