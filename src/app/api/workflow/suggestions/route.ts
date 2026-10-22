import { route } from "@/lib/api";
import { pendingSuggestions } from "@/lib/workflow";

export const dynamic = "force-dynamic";
// How many dependency suggestions are waiting for a decision (the sidebar adds this to the captures to review).
export const GET = route({}, () => ({ count: pendingSuggestions().length }));
