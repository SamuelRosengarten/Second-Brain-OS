import { route } from "@/lib/api";
import { createBackup, exportAll, listBackups } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const GET = route({}, () => ({ backups: listBackups() }));
export const POST = route({}, async ({ url }) => (url.searchParams.get("export") === "1" ? { export: exportAll() } : { backup: await createBackup() }));
