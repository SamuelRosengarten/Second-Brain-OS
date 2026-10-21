import { route } from "@/lib/api";
import { buildBriefing } from "@/lib/briefing";
import { isYmd } from "@/lib/dates";

export const dynamic = "force-dynamic";
/** `?today=YYYY-MM-DD` lets a browser in another timezone get "today" and "overdue" by its own calendar. */
export const GET = route({}, ({ url }) => {
  const today = url.searchParams.get("today");
  return buildBriefing(isYmd(today) ? today : undefined);
});
