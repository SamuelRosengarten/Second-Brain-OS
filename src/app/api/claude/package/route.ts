import { z } from "zod";
import { route } from "@/lib/api";
import { buildContextPackage } from "@/lib/claude-handoff";

export const dynamic = "force-dynamic";
/** Builds a Markdown package locally for the user to review. Nothing is sent anywhere. */
export const POST = route(
  { body: z.object({ noteIds: z.array(z.string()).max(50).default([]), projectId: z.string().optional(), question: z.string().max(10_000).default("") }) },
  ({ body }) => buildContextPackage(body),
);
