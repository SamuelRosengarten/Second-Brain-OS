import { route } from "@/lib/api";
import { listConversations } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const GET = route({}, () => ({ conversations: listConversations() }));
