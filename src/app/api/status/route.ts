import { route } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { getChatModel } from "@/lib/chat";
import { getProvider } from "@/lib/ollama";
import { embeddingStatus } from "@/lib/search";
import { captureCounts } from "@/lib/captures";

export const dynamic = "force-dynamic";
export const GET = route({}, async () => {
  const cfg = getConfig();
  const h = await getProvider().health();
  const chatModel = getChatModel();
  const names = h.models.map((m) => m.name);
  const has = (m: string) => names.some((n) => n === m || n === `${m}:latest`);
  return {
    ollama: { ok: h.ok, error: h.error, models: h.models },
    chatModel: { name: chatModel, installed: has(chatModel) },
    embedModel: { name: cfg.embedModel, installed: has(cfg.embedModel), ...embeddingStatus() },
    captures: captureCounts(),
    dataDir: cfg.dataDir,
  };
});
