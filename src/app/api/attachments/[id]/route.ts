import fs from "node:fs";
import { route } from "@/lib/api";
import { attachmentFile } from "@/lib/captures";

export const dynamic = "force-dynamic";
/** Served with a locked-down content type so stored files can never run as a page. */
export const GET = route({}, ({ params, url }) => {
  const f = attachmentFile(params.id);
  const inline = url.searchParams.get("inline") === "1" && f.mime.startsWith("image/");
  const data = fs.readFileSync(f.fullPath);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": inline ? f.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
