import { json, route } from "@/lib/api";
import { assertCaptureToken, createShareCapture, ShareBody } from "@/lib/share";

export const dynamic = "force-dynamic";

// Used by an iPhone Shortcut. Not cookie-authenticated: it needs the Bearer SBOS_CAPTURE_TOKEN and can only create captures.
export const POST = route({ public: true, guard: assertCaptureToken, body: ShareBody }, async ({ body }) => {
  const r = await createShareCapture(body);
  return json({ id: r.capture.id, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
});
