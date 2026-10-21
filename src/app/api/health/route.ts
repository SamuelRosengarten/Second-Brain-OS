import { json } from "@/lib/api";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
/** Public liveness probe: reveals nothing beyond "the app and its database are up". */
export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
