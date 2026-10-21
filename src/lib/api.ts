import { z } from "zod";
import { getConfig } from "./config.ts";
import { isAuthenticated, isPasswordSet } from "./auth.ts";
import { log } from "./util.ts";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_JSON_BYTES = 2 * 1024 * 1024;

export const json = (data: unknown, status = 200, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

/** CSRF defence for state-changing requests: custom header (blocks cross-site forms) + Origin check when present. */
export function assertSameOrigin(req: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (req.headers.get("x-sbos") !== "1") throw new ApiError(403, "Missing CSRF header", "csrf");
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("host");
  const allowed = new Set(getConfig().allowedOrigins);
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (!allowed.has(origin)) throw new ApiError(403, "Cross-origin request rejected", "csrf");
}

type Ctx<B> = { req: Request; body: B; params: Record<string, string>; url: URL };
type Opts<S extends z.ZodType | undefined> = { public?: boolean; guard?: (req: Request) => void; body?: S };

export function route<S extends z.ZodType | undefined = undefined>(
  opts: Opts<S>,
  fn: (c: Ctx<S extends z.ZodType ? z.output<S> : undefined>) => Promise<unknown> | unknown,
) {
  return async (req: Request, rc?: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      assertSameOrigin(req);
      if (!opts.public) {
        if (!isPasswordSet()) throw new ApiError(503, "No password configured. Run `npm run set-password`.", "setup_required");
        if (!isAuthenticated(req.headers.get("cookie"))) throw new ApiError(401, "Not signed in", "unauthenticated");
      }
      opts.guard?.(req); // custom auth for public routes; runs before the body is read
      let body: unknown = undefined;
      if (opts.body) {
        const text = await req.text();
        if (text.length > MAX_JSON_BYTES) throw new ApiError(413, "Request body too large", "too_large");
        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          throw new ApiError(400, "Invalid JSON", "bad_json");
        }
        body = opts.body.parse(parsed);
      }
      const params = rc?.params ? await rc.params : {};
      const result = await fn({ req, body: body as never, params, url: new URL(req.url) });
      return result instanceof Response ? result : json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message, code: e.code }, e.status);
      if (e instanceof z.ZodError) {
        return json(
          { error: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), code: "validation" },
          400,
        );
      }
      log("error", "api.unhandled", {
        url: new URL(req.url).pathname,
        message: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      });
      return json({ error: "Internal error", code: "internal" }, 500);
    }
  };
}
