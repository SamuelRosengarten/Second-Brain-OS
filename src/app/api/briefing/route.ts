import { route } from "@/lib/api";
import { buildBriefing } from "@/lib/briefing";

export const dynamic = "force-dynamic";
export const GET = route({}, () => buildBriefing());
