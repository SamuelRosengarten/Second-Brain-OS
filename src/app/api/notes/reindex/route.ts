import { route } from "@/lib/api";
import { reindexVault } from "@/lib/notes";

export const dynamic = "force-dynamic";
export const POST = route({}, () => reindexVault());
