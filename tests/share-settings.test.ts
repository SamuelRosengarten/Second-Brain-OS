import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/api/settings/share/route.ts";
import { createSessionToken, setPassword, SESSION_COOKIE } from "../src/lib/auth.ts";
import { cleanup, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); setPassword("a-very-long-password"); });
afterEach(() => { delete process.env.SBOS_CAPTURE_TOKEN; cleanup(dir); });
const call = (cookie?: string) => GET(new Request("http://localhost:3000/api/settings/share", { headers: { host: "localhost:3000", ...(cookie ? { cookie } : {}) } }));

describe("share setup endpoint", () => {
  it("never reveals the token to a signed-out request", async () => {
    process.env.SBOS_CAPTURE_TOKEN = "s".repeat(40);
    const r = await call();
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain("sssss");
  });
  it("gives a signed-in user the token only when the feature is enabled", async () => {
    const cookie = `${SESSION_COOKIE}=${createSessionToken()}`;
    expect(await (await call(cookie)).json()).toEqual({ enabled: false, token: "" });
    process.env.SBOS_CAPTURE_TOKEN = "short";
    expect(await (await call(cookie)).json()).toEqual({ enabled: false, token: "" });
    process.env.SBOS_CAPTURE_TOKEN = "s".repeat(40);
    expect(await (await call(cookie)).json()).toEqual({ enabled: true, token: "s".repeat(40) });
  });
});
