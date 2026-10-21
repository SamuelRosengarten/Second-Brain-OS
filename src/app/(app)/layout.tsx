import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { sessionSecretProblem } from "@/lib/config";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ok = false;
  if (!sessionSecretProblem()) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    try {
      ok = verifySessionToken(token);
    } catch {
      ok = false;
    }
  }
  if (!ok) redirect("/login");
  return <Shell>{children}</Shell>;
}
