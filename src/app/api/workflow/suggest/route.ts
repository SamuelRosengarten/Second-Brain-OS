import { route } from "@/lib/api";
import { generateDepSuggestions } from "@/lib/workflow";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
// Asks the local model for dependency suggestions. They are stored as pending proposals only; nothing changes until the user accepts one.
export const POST = route({}, ({ req }) => generateDepSuggestions({ signal: req.signal }));
