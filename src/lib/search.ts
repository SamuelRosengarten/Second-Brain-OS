import { getConfig } from "./config.ts";
import { getDb } from "./db.ts";
import { getProvider, OllamaError } from "./ollama.ts";

export interface SearchHit {
  noteId: string;
  title: string;
  path: string;
  heading: string;
  chunkIndex: number;
  snippet: string;
  text: string;
  score: number;
  via: ("keyword" | "semantic")[];
}
export interface SearchResult {
  hits: SearchHit[];
  semantic: { used: boolean; reason?: string };
}

const STOP = new Set("a an the and or of to in on for with is are was were be been it this that what which who how why when where do does did i you we they my your our at by from as about into can could should would".split(" "));

/** Build a safe FTS5 MATCH expression from free text (no operator injection). */
export function ftsQuery(q: string, op: "AND" | "OR" = "AND"): string | null {
  const tokens = (q.normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? []).map((t) => t.toLowerCase());
  const useful = op === "OR" ? tokens.filter((t) => !STOP.has(t) && t.length > 1) : tokens;
  const list = (useful.length ? useful : tokens).slice(0, 12);
  if (!list.length) return null;
  return list.map((t, i) => `"${t}"${i === list.length - 1 || op === "OR" ? "*" : ""}`).join(` ${op} `);
}

interface FtsRow {
  note_id: string; chunk_id: number; title: string; path: string; heading: string; idx: number; text: string; rank: number; snip: string;
}

function keywordSearch(q: string, limit: number, noteIds?: string[]): SearchHit[] {
  const db = getDb();
  const run = (expr: string): FtsRow[] => {
    const filter = noteIds?.length ? `AND f.note_id IN (${noteIds.map(() => "?").join(",")})` : "";
    return db
      .prepare(
        `SELECT f.note_id, f.chunk_id, n.title, n.path, c.heading, c.idx, c.text, bm25(note_fts, 0, 0, 4, 2, 1, 2) AS rank,
                snippet(note_fts, 4, '[[', ']]', '…', 16) AS snip
         FROM note_fts f JOIN chunks c ON c.id = f.chunk_id JOIN notes n ON n.id = f.note_id
         WHERE note_fts MATCH ? ${filter} ORDER BY rank LIMIT ?`,
      )
      .all(expr, ...(noteIds ?? []), limit) as FtsRow[];
  };
  let rows: FtsRow[] = [];
  const and = ftsQuery(q, "AND");
  if (and) rows = run(and);
  if (!rows.length) {
    const or = ftsQuery(q, "OR");
    if (or) rows = run(or);
  }
  return rows.map((r) => ({
    noteId: r.note_id, title: r.title, path: r.path, heading: r.heading, chunkIndex: r.idx,
    snippet: r.snip, text: r.text, score: -r.rank, via: ["keyword"],
  }));
}

// ---------- embeddings ----------
const toBlob = (v: number[]): Buffer => Buffer.from(new Float32Array(v).buffer);
const fromBlob = (b: Buffer): Float32Array => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface EmbedStatus { total: number; embedded: number; model: string }
export function embeddingStatus(): EmbedStatus {
  const model = getConfig().embedModel;
  const r = getDb()
    .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN embedding IS NOT NULL AND embed_model = ? THEN 1 ELSE 0 END) AS e FROM chunks WHERE text <> ''")
    .get(model) as { total: number; e: number | null };
  return { total: r.total, embedded: r.e ?? 0, model };
}

/** Embed all chunks that lack a vector for the configured model. Safe to re-run; the index is fully rebuildable. */
export async function embedPending(max = 500): Promise<{ embedded: number; error?: string; hint?: string }> {
  const db = getDb();
  const model = getConfig().embedModel;
  const rows = db
    .prepare("SELECT id, text FROM chunks WHERE text <> '' AND (embedding IS NULL OR embed_model IS NOT ?) LIMIT ?")
    .all(model, max) as { id: number; text: string }[];
  let done = 0;
  const upd = db.prepare("UPDATE chunks SET embedding = ?, embed_model = ? WHERE id = ?");
  try {
    for (let i = 0; i < rows.length; i += 16) {
      const batch = rows.slice(i, i + 16);
      const vecs = await getProvider().embed(model, batch.map((r) => r.text));
      db.transaction(() => batch.forEach((r, j) => upd.run(toBlob(vecs[j]), model, r.id)))();
      done += batch.length;
    }
    return { embedded: done };
  } catch (e) {
    if (e instanceof OllamaError) return { embedded: done, error: e.message, hint: e.hint };
    throw e;
  }
}

export function clearEmbeddings(): void {
  getDb().prepare("UPDATE chunks SET embedding = NULL, embed_model = NULL").run();
}

async function semanticSearch(q: string, limit: number, noteIds?: string[]): Promise<SearchHit[]> {
  const model = getConfig().embedModel;
  const [qv] = await getProvider().embed(model, [q]);
  const query = Float32Array.from(qv);
  const filter = noteIds?.length ? `AND c.note_id IN (${noteIds.map(() => "?").join(",")})` : "";
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.note_id, c.heading, c.idx, c.text, c.embedding, n.title, n.path FROM chunks c JOIN notes n ON n.id = c.note_id
       WHERE c.embedding IS NOT NULL AND c.embed_model = ? ${filter}`,
    )
    .all(model, ...(noteIds ?? [])) as { note_id: string; heading: string; idx: number; text: string; embedding: Buffer; title: string; path: string }[];
  return rows
    .map((r) => ({ r, s: cosine(query, fromBlob(r.embedding)) }))
    .filter((x) => x.s > 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ r, s }) => ({
      noteId: r.note_id, title: r.title, path: r.path, heading: r.heading, chunkIndex: r.idx,
      snippet: r.text.slice(0, 200), text: r.text, score: s, via: ["semantic" as const],
    }));
}

/** Hybrid search via reciprocal-rank fusion; falls back to keyword-only when embeddings are unavailable. */
export async function search(q: string, opts: { limit?: number; mode?: "hybrid" | "keyword"; noteIds?: string[] } = {}): Promise<SearchResult> {
  const limit = opts.limit ?? 20;
  const query = q.trim();
  if (!query) return { hits: [], semantic: { used: false, reason: "empty query" } };
  const kw = keywordSearch(query, limit * 2, opts.noteIds);
  if (opts.mode === "keyword") return { hits: kw.slice(0, limit), semantic: { used: false, reason: "keyword mode" } };

  const status = embeddingStatus();
  if (status.embedded === 0) {
    return { hits: kw.slice(0, limit), semantic: { used: false, reason: "No embeddings yet. Run `ollama pull " + status.model + "` and click “Build semantic index”." } };
  }
  let sem: SearchHit[];
  try {
    sem = await semanticSearch(query, limit * 2, opts.noteIds);
  } catch (e) {
    const reason = e instanceof OllamaError ? e.message : "semantic search failed";
    return { hits: kw.slice(0, limit), semantic: { used: false, reason } };
  }
  const key = (h: SearchHit) => `${h.noteId}:${h.chunkIndex}`;
  const fused = new Map<string, SearchHit>();
  const add = (list: SearchHit[]) =>
    list.forEach((h, rank) => {
      const prev = fused.get(key(h));
      const rrf = 1 / (60 + rank);
      if (prev) {
        prev.score += rrf;
        prev.via = Array.from(new Set([...prev.via, ...h.via]));
        if (h.via[0] === "keyword") prev.snippet = h.snippet;
      } else fused.set(key(h), { ...h, score: rrf });
    });
  add(kw);
  add(sem);
  return { hits: [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit), semantic: { used: true } };
}
