import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptPosting, archivePosting, buildKickoff, deletePosting, deleteSaved, knownUrls, listPostings, listSaved, normalizeUrl, parseScoutOutput, PostingPatch, runScout, savePostings, scoutEnv, updatePosting } from "../src/lib/scout.ts";
import { draftMailto } from "../src/lib/scout-draft.ts";
import { cleanup, freshEnv } from "./helpers.ts";

let dir: string;
beforeEach(() => { dir = freshEnv(); });
afterEach(() => cleanup(dir));

const agentJson = (postings: unknown[], notes = "ok") => "Here you go:\n```json\n" + JSON.stringify({ postings, notes }) + "\n```";
const good = { company: "Behaviour", title: "Stagiaire", url: "https://www.bhvr.com/careers/stage/?utm_source=x#top", score: 4, dates: "Hiver 2027", technologies: ["C++", "Unreal"], draft: "Bonjour" };

describe("normalizeUrl", () => {
  it("strips tracking, fragment, trailing slash and host case", () => {
    expect(normalizeUrl("https://WWW.bhvr.com/careers/stage/?utm_source=x&b=1&a=2#top")).toBe("https://www.bhvr.com/careers/stage?a=2&b=1");
  });
  it("rejects junk and non-http schemes", () => {
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("parseScoutOutput", () => {
  it("parses fenced JSON, maps aliases, drops unusable rows", () => {
    const r = parseScoutOutput(agentJson([good, { company: "x" }, "junk", { ...good, url: "https://ca.indeed.com/jobs?q=stage&l=Montreal", title: "Search" }]));
    expect(r.postings).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(r.postings[0]).toMatchObject({ url: "https://www.bhvr.com/careers/stage", url_type: "posting", score: 4, dates_note: "Hiver 2027", technologies: "C++, Unreal" });
    expect(r.postings[1].url_type).toBe("search_page");
  });
  it("accepts bare JSON and rejects text without it", () => {
    expect(parseScoutOutput(JSON.stringify({ postings: [good] })).postings).toHaveLength(1);
    expect(() => parseScoutOutput("I could not search.")).toThrow(/expected JSON/);
  });
  it("keeps a recruiter email only when a source URL is given", () => {
    const r = parseScoutOutput(agentJson([
      { ...good, url: "https://a.ca/1", recruiter_email: "stages@bhvr.com", email_source: "https://bhvr.com/stages" },
      { ...good, url: "https://a.ca/2", recruiter_email: "guess@bhvr.com" },
    ]));
    expect(r.postings[0].recruiter_email).toBe("stages@bhvr.com");
    expect(r.postings[1].recruiter_email).toBeNull();
  });
  it("nulls out-of-range scores", () => {
    expect(parseScoutOutput(agentJson([{ ...good, score: 9 }])).postings[0].score).toBeNull();
  });
});

describe("storage", () => {
  it("skips known URLs and never overwrites your status", () => {
    const first = parseScoutOutput(agentJson([good])).postings;
    expect(savePostings(first, null)).toEqual({ added: 1, duplicates: 0 });
    const id = listPostings()[0].id;
    updatePosting(id, { status: "applied" });
    expect(savePostings(first, null)).toEqual({ added: 0, duplicates: 1 });
    expect(listPostings()[0].status).toBe("applied");
    expect(knownUrls()).toEqual(["https://www.bhvr.com/careers/stage"]);
  });
  it("validates status values", () => {
    expect(PostingPatch.safeParse({ status: "hired" }).success).toBe(false);
    expect(PostingPatch.safeParse({ url: "x" }).success).toBe(false);
  });
});

describe("runScout", () => {
  it("stores postings from the agent and records the run", async () => {
    const r = await runScout(async () => ({ text: agentJson([good]), sessionId: "sesn_1", usage: { output_tokens: 10 } }));
    expect(r).toMatchObject({ found: 1, added: 1 });
    const again = await runScout(async () => ({ text: agentJson([good]), sessionId: "sesn_2", usage: null }));
    expect(again).toMatchObject({ found: 1, added: 0 });
  });
  it("records a failure on malformed output", async () => {
    await expect(runScout(async () => ({ text: "nope", sessionId: "s", usage: null }))).rejects.toThrow();
  });
});

describe("kickoff + config + drafts", () => {
  it("passes seen URLs back and forbids sending", () => {
    const k = buildKickoff(["https://a.ca/1"]);
    expect(k).toContain("- https://a.ca/1");
    expect(k).toMatch(/Do not send any email/);
  });
  it("needs key, agent and environment", () => {
    expect(() => scoutEnv({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => scoutEnv({ ANTHROPIC_API_KEY: "k" })).toThrow(/SBOS_SCOUT_AGENT_ID/);
    expect(scoutEnv({ ANTHROPIC_API_KEY: "k", SBOS_SCOUT_AGENT_ID: "agent_1", SBOS_SCOUT_ENV_ID: "env_1" })).toEqual({ agentId: "agent_1", environmentId: "env_1" });
  });
  it("addresses drafts only to the owner and writes the real recipient in the body", () => {
    const link = draftMailto({ company: "B", title: "T", recruiter_email: "stages@bhvr.com", draft_text: "Bonjour", url: "https://a.ca" }, "me@example.com");
    expect(link.startsWith("mailto:me%40example.com?")).toBe(true);
    expect(decodeURIComponent(link)).toContain("Real recipient: stages@bhvr.com");
    expect(link.match(/mailto:/g)).toHaveLength(1);
    expect(link).not.toMatch(/[?&](to|cc|bcc)=/i);
  });
});

describe("accept, deny, replace", () => {
  const other = { company: "Other", title: "Stage", url: "https://other.example/jobs/1", score: 3, dates: "x", technologies: "C#" };
  const third = { company: "Third", title: "Stage", url: "https://third.example/jobs/1", score: 2, dates: "x", technologies: "SQL" };

  it("replaces postings you never decided on, keeps accepted ones, and never brings dismissed ones back", () => {
    const a = parseScoutOutput(agentJson([good, other])).postings;
    savePostings(a, null);
    const keep = listPostings().find((p) => p.company === "Behaviour")!;
    acceptPosting(keep.id, "Bonjour");
    savePostings(parseScoutOutput(agentJson([third])).postings, null);
    expect(listPostings().map((p) => p.company).sort()).toEqual(["Behaviour", "Third"]);
    expect(listPostings().find((p) => p.company === "Behaviour")!.status).toBe("interested");
    expect(savePostings(parseScoutOutput(agentJson([other])).postings, null).added).toBe(0);
    expect(knownUrls()).toContain("https://other.example/jobs/1");
  });
  it("keeps the old list when a run brings nothing new", () => {
    savePostings(parseScoutOutput(agentJson([good])).postings, null);
    savePostings([], null);
    expect(listPostings()).toHaveLength(1);
  });
  it("deny removes and remembers; remove & save keeps an archive copy", () => {
    savePostings(parseScoutOutput(agentJson([good, other])).postings, null);
    const [x, y] = listPostings();
    deletePosting(x.id);
    expect(listPostings()).toHaveLength(1);
    acceptPosting(y.id, "Hello");
    archivePosting(y.id);
    expect(listPostings()).toHaveLength(0);
    expect(listSaved()).toHaveLength(1);
    expect(listSaved()[0].draft_text).toBe("Hello");
    expect(savePostings(parseScoutOutput(agentJson([good, other])).postings, null).added).toBe(0);
    deleteSaved(listSaved()[0].id);
    expect(listSaved()).toHaveLength(0);
  });
});

describe("composeMailto", () => {
  it("addresses the recruiter only when a public address exists, and fills subject and body", async () => {
    const { composeMailto } = await import("../src/lib/scout-draft.ts");
    const withMail = composeMailto({ title: "Stagiaire dev", company: "X", recruiter_email: "cv@x.ca" }, "Bonjour");
    expect(withMail.startsWith("mailto:cv@x.ca?subject=")).toBe(true);
    expect(withMail).toContain("body=Bonjour");
    expect(composeMailto({ title: "Developer Intern", company: "X", recruiter_email: null }, "Hi").startsWith("mailto:?subject=Internship")).toBe(true);
  });
});

describe("gmailCompose", () => {
  it("builds a Gmail compose URL with recipient, subject and body", async () => {
    const { gmailCompose } = await import("../src/lib/scout-draft.ts");
    const u = new URL(gmailCompose({ title: "Stagiaire dev", company: "X", recruiter_email: "cv@x.ca" }, "Bonjour & merci"));
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/u/0/");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("to")).toBe("cv@x.ca");
    expect(u.searchParams.get("su")).toBe("Candidature de stage - Stagiaire dev");
    expect(u.searchParams.get("body")).toBe("Bonjour & merci");
    expect(new URL(gmailCompose({ title: "Dev Intern", company: "X", recruiter_email: null }, "Hi")).searchParams.get("to")).toBe("");
  });
});
