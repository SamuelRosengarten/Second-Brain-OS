import { route } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { MIN_CAPTURE_TOKEN } from "@/lib/share";

export const dynamic = "force-dynamic";
// Signed-in users only (cookie auth, no `public`). The token is handed back so the Settings page can show it for the iPhone Shortcut.
export const GET = route({}, () => {
  const token = getConfig().captureToken;
  const enabled = token.length >= MIN_CAPTURE_TOKEN;
  return { enabled, token: enabled ? token : "" };
});
