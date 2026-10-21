import { z } from "zod";
import { route } from "@/lib/api";
import { getChatModel, getSystemPrompt } from "@/lib/chat";
import { setSetting } from "@/lib/db";
import { DEFAULT_CHAT_SYSTEM_PROMPT } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const GET = route({}, () => ({ chat_model: getChatModel(), system_prompt: getSystemPrompt(), default_system_prompt: DEFAULT_CHAT_SYSTEM_PROMPT }));
export const PUT = route(
  { body: z.object({ chat_model: z.string().trim().min(1).max(100).optional(), system_prompt: z.string().max(4000).optional() }) },
  ({ body }) => {
    if (body.chat_model) setSetting("chat_model", body.chat_model);
    if (body.system_prompt !== undefined) setSetting("system_prompt", body.system_prompt.trim() || DEFAULT_CHAT_SYSTEM_PROMPT);
    return { chat_model: getChatModel(), system_prompt: getSystemPrompt() };
  },
);
