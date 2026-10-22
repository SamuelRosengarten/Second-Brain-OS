import { z } from "zod";
import { ApiError } from "./api.ts";
import { getDb } from "./db.ts";
import { log, newId, nowIso } from "./util.ts";

export const STATUSES = ["new", "interested", "emailed", "applied", "interview", "rejected", "closed"] as const;
export type PostingStatus = (typeof STATUSES)[number];

export interface Posting {
  id: string; company: string; title: string; url: string; url_type: "posting" | "search_page"; score: number | null;
  dates_note: string; technologies: string; status: PostingStatus; recruiter_email: string | null; email_source_url: string | null;
  draft_text: string; notes: string; first_seen_at: string; updated_at: string;
}

/** One key for "same page": no fragment, no tracking params, no trailing slash, lowercase host. */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  u.hostname = u.hostname.toLowerCase();
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.search || u.pathname !== "/" ? u.toString() : u.toString().replace(/\/$/, "");
}

const str = z.preprocess((v) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)), z.string());
const text = (v: unknown): string => str.parse(v);
const first = (o: Record<string, unknown>, ...keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v != null && v !== "");

export interface ParsedPosting {
  company: string; title: string; url: string; url_type: "posting" | "search_page"; score: number | null; dates_note: string;
  technologies: string; recruiter_email: string | null; email_source_url: string | null; draft_text: string;
}
export interface ParsedScout { postings: ParsedPosting[]; skipped: number; notes: string }

export function extractJson(raw: string): unknown {
  const fenced = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]).reverse();
  const candidates = [...fenced, raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && "postings" in v) return v;
    } catch { /* try next */ }
  }
  return null;
}

/** The agent's JSON is untrusted: accept a few field spellings, validate each posting, drop the broken ones. */
export function parseScoutOutput(raw: string): ParsedScout {
  const root = extractJson(raw) as { postings?: unknown; notes?: unknown } | null;
  if (!root || !Array.isArray(root.postings)) throw new Error("The agent did not return the expected JSON ({\"postings\": [...]}).");
  const out: ParsedPosting[] = [];
  let skipped = 0;
  for (const item of root.postings) {
    if (!item || typeof item !== "object") { skipped++; continue; }
    const o = item as Record<string, unknown>;
    const url = normalizeUrl(text(first(o, "url", "link", "posting_url")));
    const company = text(first(o, "company", "employer")).trim();
    const title = text(first(o, "title", "job_title", "role")).trim();
    if (!url || !company || !title) { skipped++; continue; }
    const rawType = text(first(o, "url_type", "link_type")).toLowerCase();
    const looksLikeSearch = /search/.test(rawType) || /[?&](q|query|keywords?)=/i.test(url) || /\/jobs\/search|\/search\b/i.test(url);
    const score = Number(first(o, "score", "fit", "fit_score"));
    const email = text(first(o, "recruiter_email", "email")).trim();
    const emailSource = normalizeUrl(text(first(o, "email_source", "email_source_url", "recruiter_email_source")));
    // Rule: a recruiter email is only kept when the agent cited a source page for it.
    const keepEmail = z.email().safeParse(email).success && emailSource !== null;
    out.push({
      company: company.slice(0, 200), title: title.slice(0, 300), url, url_type: looksLikeSearch ? "search_page" : "posting",
      score: Number.isInteger(score) && score >= 1 && score <= 5 ? score : null,
      dates_note: text(first(o, "dates_note", "dates", "dates_or_deadline", "deadline")).slice(0, 500),
      technologies: text(first(o, "technologies", "tech", "stack")).slice(0, 500),
      recruiter_email: keepEmail ? email : null,
      email_source_url: keepEmail ? emailSource : null,
      draft_text: text(first(o, "draft", "draft_email", "draft_text", "email_draft")).slice(0, 5000),
    });
  }
  return { postings: out, skipped, notes: text(root.notes).slice(0, 2000) };
}

/** Every URL the agent must not return again: current, saved and dismissed. Oldest first, so the prompt keeps the most recent. */
export function knownUrls(): string[] {
  const rows = getDb().prepare(
    "SELECT url FROM (SELECT url, first_seen_at AS t FROM postings UNION SELECT url, saved_at FROM saved_postings UNION SELECT url, at FROM dismissed_urls) ORDER BY t",
  ).all() as { url: string }[];
  return [...new Set(rows.map((r) => r.url))];
}

function dismissUrl(url: string): void {
  getDb().prepare("INSERT OR IGNORE INTO dismissed_urls (url, at) VALUES (?, ?)").run(url, nowIso());
}

/**
 * Insert new URLs only (the status of a row you already have is never touched). When a run brings something new, the
 * postings you never decided on are dropped and remembered as dismissed; accepted ones stay. Saved or dismissed URLs never come back.
 */
export function savePostings(parsed: ParsedPosting[], runId: string | null): { added: number; duplicates: number } {
  const db = getDb();
  const now = nowIso();
  const blocked = new Set((db.prepare("SELECT url FROM saved_postings UNION SELECT url FROM dismissed_urls").all() as { url: string }[]).map((r) => r.url));
  const fresh = parsed.filter((p) => !blocked.has(p.url));
  const incoming = new Set(fresh.map((p) => p.url));
  const ins = db.prepare(`INSERT OR IGNORE INTO postings (id, company, title, url, url_type, score, dates_note, technologies, status, recruiter_email, email_source_url, draft_text, scout_run_id, first_seen_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`);
  let added = 0;
  db.transaction(() => {
    if (fresh.length > 0) {
      for (const o of db.prepare("SELECT url FROM postings WHERE status = 'new'").all() as { url: string }[]) {
        if (incoming.has(o.url)) continue;
        dismissUrl(o.url);
        db.prepare("DELETE FROM postings WHERE url = ?").run(o.url);
      }
    }
    for (const p of fresh) {
      added += ins.run(newId(), p.company, p.title, p.url, p.url_type, p.score, p.dates_note, p.technologies, p.recruiter_email, p.email_source_url, p.draft_text, runId, now, now).changes;
    }
  })();
  return { added, duplicates: parsed.length - added };
}

export function listPostings(): Posting[] {
  return getDb().prepare("SELECT * FROM postings ORDER BY (status = 'new') DESC, score DESC, first_seen_at DESC").all() as Posting[];
}

export const PostingPatch = z.object({
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(5000).optional(),
  draft_text: z.string().max(5000).optional(),
}).strict();

export function updatePosting(id: string, patch: z.infer<typeof PostingPatch>): Posting {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM postings WHERE id = ?").get(id)) throw new ApiError(404, "Posting not found", "not_found");
  const sets = Object.keys(patch).map((k) => `${k} = @${k}`);
  if (sets.length) db.prepare(`UPDATE postings SET ${sets.join(", ")}, updated_at = @now WHERE id = @id`).run({ ...patch, now: nowIso(), id });
  return db.prepare("SELECT * FROM postings WHERE id = ?").get(id) as Posting;
}

/** Deny: the posting disappears and its URL is remembered, so the scout does not bring it back. */
export function deletePosting(id: string): void {
  const db = getDb();
  const row = db.prepare("SELECT url FROM postings WHERE id = ?").get(id) as { url: string } | undefined;
  if (!row) return;
  db.transaction(() => {
    dismissUrl(row.url);
    db.prepare("DELETE FROM postings WHERE id = ?").run(id);
  })();
}

export interface SavedPosting {
  id: string; company: string; title: string; url: string; url_type: "posting" | "search_page"; score: number | null; dates_note: string;
  technologies: string; recruiter_email: string | null; email_source_url: string | null; draft_text: string; saved_at: string;
}

const SAVE_COPY = `INSERT OR REPLACE INTO saved_postings (id, company, title, url, url_type, score, dates_note, technologies, recruiter_email, email_source_url, draft_text, saved_at)
  SELECT id, company, title, url, url_type, score, dates_note, technologies, recruiter_email, email_source_url, draft_text, ? FROM postings WHERE id = ?`;

/** Accept: keeps the posting, stores the email draft, and archives a copy right away so a later scout run can never remove it. */
export function acceptPosting(id: string, draft: string): Posting {
  const db = getDb();
  const p = db.prepare("SELECT draft_text FROM postings WHERE id = ?").get(id) as { draft_text: string } | undefined;
  if (!p) throw new ApiError(404, "Posting not found", "not_found");
  db.transaction(() => {
    db.prepare("UPDATE postings SET status = 'interested', draft_text = ?, updated_at = ? WHERE id = ?").run((draft || p.draft_text).slice(0, 5000), nowIso(), id);
    db.prepare(SAVE_COPY).run(nowIso(), id);
  })();
  return db.prepare("SELECT * FROM postings WHERE id = ?").get(id) as Posting;
}

/** Remove & save: refresh the archived copy (with any edits to the draft), then take the posting off the active list. */
export function archivePosting(id: string): void {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM postings WHERE id = ?").get(id)) throw new ApiError(404, "Posting not found", "not_found");
  db.transaction(() => {
    db.prepare(SAVE_COPY).run(nowIso(), id);
    db.prepare("DELETE FROM postings WHERE id = ?").run(id);
  })();
}

export function listSaved(): SavedPosting[] {
  return getDb().prepare("SELECT * FROM saved_postings ORDER BY saved_at DESC").all() as SavedPosting[];
}

/** Permanent delete from the archive; the URL is remembered so it does not come back either. */
export function deleteSaved(id: string): void {
  const db = getDb();
  const row = db.prepare("SELECT url FROM saved_postings WHERE id = ?").get(id) as { url: string } | undefined;
  if (!row) return;
  db.transaction(() => {
    dismissUrl(row.url);
    db.prepare("DELETE FROM saved_postings WHERE id = ?").run(id);
  })();
}

export const MAX_SEEN_IN_PROMPT = 200;

/** The task message sent to the agent. The CV and rules live in the agent's own system prompt. */
export function buildKickoff(seen: string[]): string {
  const list = seen.slice(-MAX_SEEN_IN_PROMPT);
  return [
    "Run a search now, following your instructions, and return the final JSON ({\"postings\": [...], \"notes\": \"...\"}).",
    list.length ? `Already stored, do NOT return these URLs again:\n${list.map((u) => `- ${u}`).join("\n")}` : "Nothing is stored yet.",
    "Do not send any email. Do not contact anyone.",
  ].join("\n\n");
}

export function scoutEnv(env: Record<string, string | undefined> = process.env): { agentId: string; environmentId: string } {
  const agentId = env.SBOS_SCOUT_AGENT_ID?.trim();
  const environmentId = env.SBOS_SCOUT_ENV_ID?.trim();
  if (!env.ANTHROPIC_API_KEY) throw new ApiError(400, "ANTHROPIC_API_KEY is not set (put it in .env.local, never in code).", "scout_config");
  if (!agentId || !environmentId) throw new ApiError(400, "Set SBOS_SCOUT_AGENT_ID and SBOS_SCOUT_ENV_ID in .env.local.", "scout_config");
  return { agentId, environmentId };
}

const RUN_TIMEOUT_MS = 9 * 60_000;

/** Runs one agent session and returns its last message. Tests inject a fake instead of calling this. */
export async function collectAgentText(): Promise<{ text: string; sessionId: string; usage: unknown }> {
  const { agentId, environmentId } = scoutEnv();
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const session = await client.beta.sessions.create({ agent: agentId, environment_id: environmentId, title: "Internship scout" });
  const stream = await client.beta.sessions.events.stream(session.id);
  await client.beta.sessions.events.send(session.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: buildKickoff(knownUrls()) }] }],
  });
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let last = "";
  loop: for await (const event of stream) {
    if (Date.now() > deadline) throw new Error("Scout timed out after 9 minutes.");
    switch (event.type) {
      case "agent.message": {
        let t = "";
        for (const b of event.content) if (b.type === "text") t += b.text;
        if (t.includes("postings")) last = t; // the final JSON message; earlier chatter is ignored
        break;
      }
      case "agent.tool_use":
      case "agent.mcp_tool_use":
        // Unattended run: if a call pauses for approval, deny it.
        if (event.evaluated_permission === "ask") {
          await client.beta.sessions.events.send(session.id, { events: [{ type: "user.tool_confirmation", tool_use_id: event.id, result: "deny" }] });
        }
        break;
      case "session.status_idle":
        if (event.stop_reason.type !== "requires_action") break loop;
        break;
      case "session.status_terminated":
        break loop;
    }
  }
  const final = await client.beta.sessions.retrieve(session.id);
  return { text: last, sessionId: session.id, usage: (final as { usage?: unknown }).usage ?? null };
}

export async function runScout(collect: typeof collectAgentText = collectAgentText): Promise<{ runId: string; found: number; added: number; skipped: number; notes: string }> {
  const db = getDb();
  const runId = newId();
  db.prepare("INSERT INTO scout_runs (id, status, started_at) VALUES (?, 'running', ?)").run(runId, nowIso());
  try {
    const { text: out, sessionId, usage } = await collect();
    const parsed = parseScoutOutput(out);
    const { added } = savePostings(parsed.postings, runId);
    db.prepare("UPDATE scout_runs SET status='ok', session_id=?, found=?, added=?, usage_json=?, notes=?, finished_at=? WHERE id=?")
      .run(sessionId, parsed.postings.length, added, usage ? JSON.stringify(usage) : null, parsed.notes, nowIso(), runId);
    return { runId, found: parsed.postings.length, added, skipped: parsed.skipped, notes: parsed.notes };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "failed";
    log("error", "scout.failed", { message: msg });
    db.prepare("UPDATE scout_runs SET status='error', error=?, finished_at=? WHERE id=?").run(msg, nowIso(), runId);
    throw e;
  }
}
