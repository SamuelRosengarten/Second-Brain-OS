import { ApiError } from "./api.ts";
import { getConfig } from "./config.ts";

/** Read uploaded files from multipart form data, enforcing the configured size limit. */
export async function readForm(req: Request): Promise<{ fields: Record<string, string>; files: { name: string; data: Buffer }[] }> {
  const max = getConfig().maxUploadBytes;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max * 4 + 1_000_000) throw new ApiError(413, "Upload too large", "too_large");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "Invalid form data", "bad_form");
  }
  const fields: Record<string, string> = {};
  const files: { name: string; data: Buffer }[] = [];
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") fields[k] = v;
    else {
      if (v.size > max) throw new ApiError(413, `"${v.name}" exceeds the ${Math.round(max / 1048576)} MB upload limit.`, "too_large");
      files.push({ name: v.name, data: Buffer.from(await v.arrayBuffer()) });
    }
  }
  return { fields, files };
}
