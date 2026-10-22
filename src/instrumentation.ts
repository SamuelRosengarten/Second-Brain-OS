export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScoutScheduler } = await import("./lib/scout-schedule.ts");
    startScoutScheduler();
  }
}
