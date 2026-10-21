import { route } from "@/lib/api";
import { getChatModel } from "@/lib/chat";
import { getProvider, OllamaError } from "@/lib/ollama";

export const dynamic = "force-dynamic";
export const GET = route({}, async ({ url }) => {
  const selected = getChatModel();
  const cap = url.searchParams.get("capabilities");
  try {
    const models = await getProvider().listModels();
    const caps = cap ? await getProvider().capabilities(cap) : undefined;
    return { ok: true, selected, models, capabilities: caps };
  } catch (e) {
    if (e instanceof OllamaError) return { ok: false, selected, models: [], error: e.message, hint: e.hint };
    throw e;
  }
});
