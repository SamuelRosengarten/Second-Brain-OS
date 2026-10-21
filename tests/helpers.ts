import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb } from "../src/lib/db.ts";
import { setProvider, OllamaError, type LlmProvider } from "../src/lib/ollama.ts";

export function freshEnv(): string {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbos-test-"));
  process.env.SBOS_DATA_DIR = dir;
  process.env.SBOS_SESSION_SECRET = "test-secret-test-secret-test-secret-1234567890";
  process.env.SBOS_EMBED_MODEL = "fake-embed";
  process.env.SBOS_CHAT_MODEL = "fake-chat";
  setProvider(null);
  return dir;
}

export function cleanup(dir: string): void {
  closeDb();
  setProvider(null);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Deterministic bag-of-words embedding so semantic tests need no model. */
const VOCAB = ["garden", "tomato", "budget", "invoice", "python", "learning", "water", "plan", "idea", "money"];
export const fakeVector = (text: string): number[] => {
  const t = text.toLowerCase();
  return VOCAB.map((w): number => (t.includes(w) ? 1 : 0)).concat([0.01]);
};

export interface FakeOpts {
  json?: unknown | (() => unknown);
  chatChunks?: string[];
  down?: boolean;
  embedDown?: boolean;
}
export function fakeProvider(opts: FakeOpts = {}): LlmProvider & { chatCalls: { system: string; user: string }[]; jsonCalls: number } {
  const unavailable = () => new OllamaError("unavailable", "Cannot reach Ollama at http://127.0.0.1:11434.", "Start Ollama and try again.");
  const p = {
    id: "fake",
    chatCalls: [] as { system: string; user: string }[],
    jsonCalls: 0,
    async health() { return opts.down ? { ok: false, error: "down", models: [] } : { ok: true, models: [{ name: "fake-chat", sizeBytes: 1 }] }; },
    async listModels() { if (opts.down) throw unavailable(); return [{ name: "fake-chat", sizeBytes: 1 }]; },
    async capabilities() { return ["completion"]; },
    async *chatStream(_m: string, messages: { role: string; content: string }[]) {
      if (opts.down) throw unavailable();
      p.chatCalls.push({ system: messages[0].content, user: messages[messages.length - 1].content });
      for (const c of opts.chatChunks ?? ["Hello ", "world"]) yield c;
    },
    async chatJson() {
      p.jsonCalls++;
      if (opts.down) throw unavailable();
      return typeof opts.json === "function" ? (opts.json as () => unknown)() : opts.json;
    },
    async embed(_m: string, inputs: string[]) {
      if (opts.down || opts.embedDown) throw unavailable();
      return inputs.map(fakeVector);
    },
  };
  return p;
}

export const goodProposal = {
  title: "Backyard tomato garden",
  summary: "Plan to grow tomatoes in the backyard.",
  category: "idea",
  tags: ["garden", "tomato"],
  related_projects: [],
  next_action: "Buy tomato seeds",
  open_questions: ["Which variety?"],
  confidence: "medium" as const,
  uncertainty: "No location details given.",
  note_markdown: "## Summary\nGrow tomatoes in the backyard.\n\n## Next action\nBuy tomato seeds",
};

