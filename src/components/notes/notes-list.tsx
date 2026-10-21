"use client";
import Link from "next/link";
import { Database, Download, Plus } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { api } from "../client";
import { cx, ErrorBox, ListSkeleton, useToast } from "../ui";
import { useNotes } from "./notes-context";

const SORTS = [{ id: "updated", label: "Recently edited" }, { id: "created", label: "Recently created" }, { id: "title", label: "Title A–Z" }];

/** FTS snippets mark matches with [[ ]]; everything else is plain text (never HTML). */
function Snippet({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  text.split(/(\[\[.*?\]\])/g).forEach((p, i) => parts.push(p.startsWith("[[") ? <mark key={i}>{p.slice(2, -2)}</mark> : <Fragment key={i}>{p}</Fragment>));
  return <>{parts}</>;
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  if (d >= midnight) return "Today";
  const y = new Date(midnight); y.setDate(y.getDate() - 1);
  return d >= y ? "Yesterday" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function NotesList({ selectedId }: { selectedId: string | null }) {
  const toast = useToast();
  const n = useNotes();
  const needsIndex = n.embed && n.embed.installed && n.embed.embedded < n.embed.total;

  async function buildIndex() {
    try {
      const r = await api<{ embedded: number; error?: string; hint?: string }>("/api/search/index", { body: {} });
      if (r.error) toast(`${r.error} ${r.hint ?? ""}`, "danger");
      else toast(`Semantic index updated (${r.embedded} passages)`, "ok");
      n.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  return (
    <section aria-labelledby="notes-h" className="flex min-w-0 flex-col gap-3.5">
      <div className="flex items-center gap-2 px-1.5">
        <h1 id="notes-h" className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Notes</h1>
        <span className="font-mono text-xs text-faint">{n.notes.length}</span>
        <button type="button" aria-label="Import files" onClick={n.openImport} className="ml-auto grid size-11 place-items-center rounded-[9px] border border-line text-muted hover:bg-hover lg:size-[34px]"><Download size={15} aria-hidden strokeWidth={1.8} /></button>
        <button type="button" aria-label="New note" onClick={n.openNew} className="grid size-11 place-items-center rounded-[9px] bg-primary text-primary-fg hover:bg-primary-hover lg:size-[34px]"><Plus size={15} aria-hidden strokeWidth={2} /></button>
      </div>

      <div className="px-1">
        <label htmlFor="notes-q" className="sr-only">Search notes</label>
        <input id="notes-q" type="search" value={n.q} onChange={(e) => n.setQ(e.target.value)} placeholder="Search by words or meaning" className="h-11 w-full rounded-[9px] border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint lg:h-9 lg:text-[13px]" />
      </div>

      {n.embed && !n.embed.installed && <p className="m-0 flex gap-2 px-1.5 text-xs text-faint"><Database size={13} aria-hidden className="mt-0.5 shrink-0" />Semantic search is off. Run <code className="font-mono text-muted">ollama pull {n.embed.name}</code>, then build the index. Until then search is keyword-only.</p>}
      {needsIndex && <p className="m-0 px-1.5 text-xs text-faint"><span className="font-mono">{n.embed!.total - n.embed!.embedded}</span> passages are not in the semantic index. <button type="button" onClick={() => void buildIndex()} className="ml-1 min-h-8 rounded-md border border-line px-2.5 text-xs text-fg hover:bg-hover">Build index</button></p>}

      {n.query ? (
        <div className="flex flex-col gap-2">
          {n.searching && <ListSkeleton rows={3} />}
          {n.searchError && <ErrorBox message={n.searchError} />}
          {n.search && !n.searching && (
            <>
              <p role="status" className="m-0 px-1.5 text-xs text-faint"><span className="font-mono">{n.search.hits.length}</span> result{n.search.hits.length === 1 ? "" : "s"} · {n.search.semantic.used ? "keywords + meaning" : "keywords only"}</p>
              {n.search.hits.length === 0 ? (
                <p className="m-0 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">Nothing in your library matched. Try other words, or ask under Ask.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {n.search.hits.map((h) => (
                    <li key={`${h.noteId}:${h.chunkIndex}`}>
                      <Link href={`/knowledge/${h.noteId}`} aria-current={h.noteId === selectedId ? "true" : undefined} className={cx("flex flex-col gap-0.5 rounded-[10px] p-2.5", h.noteId === selectedId ? "bg-hover" : "hover:bg-hover/50")}>
                        <span className="truncate text-[13.5px] font-medium">{h.title}</span>
                        <span className="line-clamp-2 text-[12.5px] text-muted"><Snippet text={h.snippet} /></span>
                        <span className="flex gap-2 font-mono text-[11px] text-faint">{h.via.map((v) => <span key={v} className={v === "semantic" ? "text-accent" : ""}>{v}</span>)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {n.tags.length > 0 && (
            <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-1.5 px-1">
              <button type="button" aria-pressed={!n.tag} onClick={() => n.setTag("")} className={cx("h-9 rounded-[7px] px-2.5 text-xs lg:h-7", !n.tag ? "bg-surface2 font-medium text-fg" : "text-muted hover:text-fg")}>All</button>
              {n.tags.slice(0, 8).map((t) => (
                <button key={t.tag} type="button" aria-pressed={n.tag === t.tag} onClick={() => n.setTag(n.tag === t.tag ? "" : t.tag)} className={cx("h-9 rounded-[7px] px-2.5 font-mono text-[11.5px] lg:h-7", n.tag === t.tag ? "bg-surface2 text-fg" : "text-muted hover:text-fg")}>#{t.tag}</button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between px-2 text-xs text-faint">
            <span>{SORTS.find((s) => s.id === n.sort)?.label}</span>
            <label className="relative flex items-center gap-1 font-mono text-[11px]">
              <span aria-hidden>Sort ▾</span>
              <span className="sr-only">Sort notes</span>
              <select value={n.sort} onChange={(e) => n.setSort(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                {SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
          </div>
          {n.error && <ErrorBox message={n.error} onRetry={n.reload} />}
          {!n.loaded && !n.error && <ListSkeleton rows={6} />}
          {n.loaded && n.notes.length === 0 && (
            <p className="m-0 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">{n.tag ? `No notes tagged #${n.tag}.` : "No notes yet. Accept a capture from the inbox, import files, or write one."}</p>
          )}
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {n.notes.map((x) => (
              <li key={x.id}>
                <Link href={`/knowledge/${x.id}`} aria-current={x.id === selectedId ? "page" : undefined} className={cx("flex flex-col gap-0.5 rounded-[10px] p-2.5", x.id === selectedId ? "bg-hover" : "hover:bg-hover/50")}>
                  <span className="truncate text-[13.5px] font-medium">{x.title}</span>
                  {x.summary && <span className="truncate text-[12.5px] text-muted">{x.summary}</span>}
                  <span className="flex gap-2 font-mono text-[11px] text-faint">
                    <span className="truncate">{x.tags[0] ? `#${x.tags[0]}` : x.category}</span>
                    <span className="ml-auto shrink-0">{shortDate(x.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
