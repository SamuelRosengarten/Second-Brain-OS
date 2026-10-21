import { captureTokenStatus, createCaptureToken, revokeCaptureToken } from "@/lib/auth";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
// Deliberately cookie-only: a leaked capture token must not be able to mint or inspect tokens.
export const GET = route({}, () => captureTokenStatus());
/** Creates or replaces the token. The plain value is in this response only. */
export const POST = route({}, () => createCaptureToken());
export const DELETE = route({}, () => {
  revokeCaptureToken();
  return captureTokenStatus();
});
