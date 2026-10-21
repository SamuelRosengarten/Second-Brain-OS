import { route } from "@/lib/api";
import { embedPending, embeddingStatus } from "@/lib/search";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const POST = route({}, async () => {
  const r = await embedPending(2000);
  return { ...r, status: embeddingStatus() };
});
