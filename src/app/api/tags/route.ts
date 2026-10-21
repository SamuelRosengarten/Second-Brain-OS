import { route } from "@/lib/api";
import { listTags } from "@/lib/notes";

export const dynamic = "force-dynamic";
export const GET = route({}, () => ({ tags: listTags() }));
