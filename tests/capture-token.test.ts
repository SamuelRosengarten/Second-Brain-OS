import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { route } from "../src/lib/api.ts";
import { bearerToken, captureTokenStatus, createCaptureToken, createSessionToken, revokeCaptureToken, setPassword, SESSION_COOKIE, verifyCaptureToken } from "../src/lib/auth.ts";
import { getDb } from "../src/lib/db.ts";
import { listCaptures } from "../src/lib/captures.ts";
import { GET as listCapturesRoute, POST as createCaptureRoute } from "../src/app/api/captures/route.ts";
import { GET as listTasksRoute } from "../src/app/api/tasks/route.ts";
import { DELETE as revokeRoute, GET as statusRoute, POST as createRoute } from "../src/app/api/settings/capture-token/route.ts";
import { cleanup, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); setPassword("a-very-long-password"); });
afterEach(() => cleanup(dir));

const url = "http://localhost:3000/api/captures";
const post = (headers: Record<string, string>, body: unknown = { content: "from the phone" }) =>
  new Request(url, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const cookie = () => `${SESSION_COOKIE}=${createSessionToken()}`;

describe("capture token", () => {
  it("is shown once, stored only as a digest, and verifies", () => {
    expect(captureTokenStatus()).toEqual({ enabled: false, createdAt: null });
    const { token, createdAt } = createCaptureToken();
    expect(token).toMatch(/^sbos_cap_[\w-]{43}$/);
    expect(captureTokenStatus()).toEqual({ enabled: true, createdAt });
    const stored = JSON.stringify(getDb().prepare("SELECT key, value FROM settings").all());
    expect(stored).not.toContain(token);
    expect(verifyCaptureToken(token)).toBe(true);
    expect(verifyCaptureToken(token + "x")).toBe(false);
    expect(verifyCaptureToken("")).toBe(false);
    expect(verifyCaptureToken("sbos_cap_" + "A".repeat(43))).toBe(false);
  });
  it("replacing it revokes the old one; revoking disables it", () => {
    const first = createCaptureToken().token;
    const second = createCaptureToken().token;
    expect(verifyCaptureToken(first)).toBe(false);
    expect(verifyCaptureToken(second)).toBe(true);
    revokeCaptureToken();
    expect(verifyCaptureToken(second)).toBe(false);
    expect(captureTokenStatus().enabled).toBe(false);
  });
  it("dies when the password changes, like a session", () => {
    const { token } = createCaptureToken();
    setPassword("another-long-password");
    expect(verifyCaptureToken(token)).toBe(false);
  });
  it("parses only well-formed bearer headers", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("capture token at the HTTP layer", () => {
  it("creates a capture with no cookie and no CSRF header", async () => {
    const { token } = createCaptureToken();
    const res = await createCaptureRoute(post({ authorization: `Bearer ${token}` }));
    expect(res.status).toBe(201);
    expect(listCaptures().map((c) => c.content)).toEqual(["from the phone"]);
  });
  it("accepts it even when the request carries a foreign Origin (not an ambient credential)", async () => {
    const { token } = createCaptureToken();
    const res = await createCaptureRoute(post({ authorization: `Bearer ${token}`, origin: "https://shortcuts.example" }));
    expect(res.status).toBe(201);
  });
  it("rejects a wrong, revoked or missing token and does not fall back to anything else", async () => {
    const { token } = createCaptureToken();
    expect((await createCaptureRoute(post({ authorization: "Bearer sbos_cap_nope" }))).status).toBe(401);
    // a bad token is not rescued by a valid session cookie either: the bearer header wins and fails
    expect((await createCaptureRoute(post({ authorization: "Bearer sbos_cap_nope", cookie: cookie(), "x-sbos": "1" }))).status).toBe(401);
    revokeCaptureToken();
    expect((await createCaptureRoute(post({ authorization: `Bearer ${token}` }))).status).toBe(401);
    expect((await createCaptureRoute(post({}))).status).toBe(403); // no token, no CSRF header
    expect(listCaptures()).toHaveLength(0);
  });
  it("normal cookie sign-in still works on the same endpoint", async () => {
    const res = await createCaptureRoute(post({ cookie: cookie(), "x-sbos": "1" }));
    expect(res.status).toBe(201);
  });
  it("is useless everywhere else: reading captures, tasks, and managing tokens", async () => {
    const { token } = createCaptureToken();
    const bearer = { authorization: `Bearer ${token}`, host: "localhost:3000" };
    const get = (path: string) => new Request(`http://localhost:3000${path}`, { headers: bearer });
    expect((await listCapturesRoute(get("/api/captures"))).status).toBe(401);
    expect((await listTasksRoute(get("/api/tasks"))).status).toBe(401);
    expect((await statusRoute(get("/api/settings/capture-token"))).status).toBe(401);
    const mutate = (method: string) => new Request("http://localhost:3000/api/settings/capture-token", { method, headers: { ...bearer, "x-sbos": "1" } });
    expect((await createRoute(mutate("POST"))).status).toBe(401);
    expect((await revokeRoute(mutate("DELETE"))).status).toBe(401);
    // and the wrapper ignores the header on a route that did not opt in
    const other = route({ body: z.object({ a: z.string() }) }, () => ({ ok: true }));
    expect((await other(post({ authorization: `Bearer ${token}` }, { a: "x" }))).status).toBe(403);
  });
  it("is manageable with a normal session", async () => {
    const h = { cookie: cookie(), "x-sbos": "1", host: "localhost:3000" };
    const made = (await (await createRoute(new Request("http://localhost:3000/api/settings/capture-token", { method: "POST", headers: h }))).json()) as { token: string };
    expect(verifyCaptureToken(made.token)).toBe(true);
    const status = await (await statusRoute(new Request("http://localhost:3000/api/settings/capture-token", { headers: h }))).json();
    expect(status).toMatchObject({ enabled: true });
    expect(JSON.stringify(status)).not.toContain(made.token);
    await revokeRoute(new Request("http://localhost:3000/api/settings/capture-token", { method: "DELETE", headers: h }));
    expect(verifyCaptureToken(made.token)).toBe(false);
  });
});
