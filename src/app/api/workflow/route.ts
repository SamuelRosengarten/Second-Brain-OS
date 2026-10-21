import { route } from "@/lib/api";
import { isYmd } from "@/lib/dates";
import { workflowData } from "@/lib/workflow";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ url }) => {
  const today = url.searchParams.get("today");
  return workflowData(isYmd(today) ? today : undefined);
});
