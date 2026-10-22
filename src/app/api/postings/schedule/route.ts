import { route } from "@/lib/api";
import { getSchedule, nextRun, saveSchedule, ScheduleInput } from "@/lib/scout-schedule";

export const dynamic = "force-dynamic";
const view = () => {
  const schedule = getSchedule();
  return { schedule, nextRun: nextRun(schedule)?.toISOString() ?? null };
};
export const GET = route({}, () => view());
export const PUT = route({ body: ScheduleInput }, ({ body }) => {
  saveSchedule(body);
  return view();
});
