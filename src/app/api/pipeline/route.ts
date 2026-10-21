import { route } from "@/lib/api";
import { isYmd } from "@/lib/dates";
import { pipelineData } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ url }) => {
  const today = url.searchParams.get("today");
  return pipelineData(isYmd(today) ? today : undefined);
});
