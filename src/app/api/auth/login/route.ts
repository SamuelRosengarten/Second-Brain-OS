import { z } from "zod";
import { ApiError, json, route } from "@/lib/api";
import { clearLoginFailures, createSessionToken, isPasswordSet, loginAllowed, recordLoginFailure, sessionCookie, verifyPassword } from "@/lib/auth";
import { sessionSecretProblem } from "@/lib/config";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";
export const POST = route({ public: true, body: z.object({ password: z.string().min(1).max(500) }) }, ({ req, body }) => {
  const problem = sessionSecretProblem();
  if (problem) throw new ApiError(503, problem, "setup_required");
  if (!isPasswordSet()) throw new ApiError(503, "No password configured. Run `npm run set-password` on the PC.", "setup_required");
  const key = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!loginAllowed(key)) throw new ApiError(429, "Too many attempts. Try again in 15 minutes.", "rate_limited");
  if (!verifyPassword(body.password, getSetting("password_hash")!)) {
    recordLoginFailure(key);
    throw new ApiError(401, "Incorrect password", "bad_credentials");
  }
  clearLoginFailures(key);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(createSessionToken()) });
});
