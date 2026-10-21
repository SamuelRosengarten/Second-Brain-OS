import { ApiError, route } from "@/lib/api";
import { importFiles, recentImports } from "@/lib/importer";
import { readForm } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = route({}, () => ({ imports: recentImports() }));
export const POST = route({}, async ({ req }) => {
  const { files } = await readForm(req);
  if (!files.length) throw new ApiError(400, "Choose at least one file.", "validation");
  if (files.length > 200) throw new ApiError(400, "Import at most 200 files at once.", "validation");
  return { results: await importFiles(files) };
});
