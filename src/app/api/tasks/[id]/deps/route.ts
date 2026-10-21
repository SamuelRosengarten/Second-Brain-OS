import { z } from "zod";
import { json, route } from "@/lib/api";
import { addDep, removeDep } from "@/lib/workflow";

export const dynamic = "force-dynamic";
// POST { depends_on } makes that task a prerequisite of this one; DELETE ?on=<id> removes the link.
export const POST = route({ body: z.object({ depends_on: z.string().min(1) }) }, ({ params, body }) => {
  addDep(params.id, body.depends_on);
  return json({ ok: true }, 201);
});
export const DELETE = route({}, ({ params, url }) => {
  removeDep(params.id, url.searchParams.get("on") ?? "");
  return { ok: true };
});
