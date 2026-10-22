import { getConfig } from "./config.ts";

/** Provider-neutral interface so other backends can be added later without touching app logic. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ModelInfo {
  name: string;
  sizeBytes: number;
}
export interface LlmProvider {
  id: string;
  health(): Promise<{ ok: boolean; error?: string; models: ModelInfo[] }>;
  listModels(): Promise<ModelInfo[]>;
  capabilities(model: string): Promise<string[]>;
  chatStream(model: string, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string>;
  chatJson(model: string, messages: ChatMessage[], schema: object, signal?: AbortSignal): Promise<unknown>;
  embed(model: string, inputs: string[]): Promise<number[][]>;
}

export type OllamaErrorCode = "unavailable" | "model_missing" | "bad_response" | "timeout";
export class OllamaError extends Error {
  code: OllamaErrorCode;
  hint?: string;
  constructor(code: OllamaErrorCode, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

/** Approximate download sizes shown in the "model missing" hint. */
const APPROX_SIZE: Record<string, string> = {
  "nomic-embed-text": "about 274 MB",
  "qwen3.5:9b": "about 6 GB",
  "llama3.2": "about 2 GB",
  "llama3.1:8b": "about 4.7 GB",
};

export function pullHint(model: string): string {
  const size = APPROX_SIZE[model] ?? APPROX_SIZE[model.split(":")[0]];
  return `Run: ollama pull ${model}${size ? `  (${size} of disk space)` : ""}`;
}

export class OllamaProvider implements LlmProvider {
  id = "ollama";
  private base: string;
  constructor(baseUrl?: string) {
    this.base = baseUrl ?? getConfig().ollamaUrl;
  }

  private async request(path: string, init: RequestInit & { timeoutMs?: number } = {}, model?: string): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 120_000);
    const outer = init.signal;
    if (outer) outer.addEventListener("abort", () => ctl.abort(), { once: true });
    let res: Response;
    try {
      res = await fetch(this.base + path, { ...init, signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (outer?.aborted) throw e;
      if (ctl.signal.aborted) throw new OllamaError("timeout", "Ollama did not respond in time.");
      throw new OllamaError(
        "unavailable",
        `Cannot reach Ollama at ${this.base}.`,
        "Start Ollama (it normally runs from the system tray) and try again.",
      );
    }
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 404 && model) {
        throw new OllamaError("model_missing", `Model "${model}" is not installed.`, pullHint(model));
      }
      throw new OllamaError("bad_response", `Ollama returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.request("/api/tags", { timeoutMs: 5000 });
    const data = (await res.json()) as { models?: { name: string; size: number }[] };
    return (data.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size }));
  }

  async health() {
    try {
      return { ok: true, models: await this.listModels() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), models: [] };
    }
  }

  async capabilities(model: string): Promise<string[]> {
    try {
      const res = await this.request(
        "/api/show",
        { method: "POST", body: JSON.stringify({ model }), headers: { "content-type": "application/json" }, timeoutMs: 8000 },
        model,
      );
      const data = (await res.json()) as { capabilities?: string[] };
      return data.capabilities ?? [];
    } catch (e) {
      if (e instanceof OllamaError && e.code === "model_missing") throw e;
      return []; // older Ollama versions do not report capabilities; treat as unknown
    }
  }

  private async chatRequest(body: Record<string, unknown>, model: string, signal?: AbortSignal): Promise<Response> {
    const send = (b: Record<string, unknown>) =>
      this.request(
        "/api/chat",
        { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" }, signal },
        model,
      );
    try {
      return await send({ ...body, think: false });
    } catch (e) {
      // Models without a thinking mode may reject the `think` option: retry without it.
      if (e instanceof OllamaError && e.code === "bad_response" && /think/i.test(e.message)) return send(body);
      throw e;
    }
  }

  async *chatStream(model: string, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    const res = await this.chatRequest({ model, messages, stream: true, options: { num_ctx: 8192 } }, model, signal); // the default window (often 4096) would silently cut off notes + workspace + history
    if (!res.body) throw new OllamaError("bad_response", "Ollama returned no stream.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const piece = (raw: string): string | null => {
      const line = raw.trim();
      if (!line) return null;
      const evt = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (evt.error) throw new OllamaError("bad_response", evt.error);
      return evt.message?.content || null;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const text = piece(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (text) yield text;
      }
    }
    // A last event that arrives without a trailing newline still counts.
    const last = piece(buf + decoder.decode());
    if (last) yield last;
  }

  async chatJson(model: string, messages: ChatMessage[], schema: object, signal?: AbortSignal): Promise<unknown> {
    const res = await this.chatRequest({ model, messages, stream: false, format: schema, options: { temperature: 0.2 } }, model, signal);
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content ?? "";
    try {
      return JSON.parse(text);
    } catch {
      throw new OllamaError("bad_response", "The model did not return valid JSON.");
    }
  }

  async embed(model: string, inputs: string[]): Promise<number[][]> {
    const res = await this.request(
      "/api/embed",
      { method: "POST", body: JSON.stringify({ model, input: inputs }), headers: { "content-type": "application/json" } },
      model,
    );
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings || data.embeddings.length !== inputs.length) {
      throw new OllamaError("bad_response", "Ollama returned an unexpected embedding response.");
    }
    return data.embeddings;
  }
}

let provider: LlmProvider | null = null;
export const getProvider = (): LlmProvider => (provider ??= new OllamaProvider());
/** Test hook: swap in a fake provider. */
export function setProvider(p: LlmProvider | null): void {
  provider = p;
}
