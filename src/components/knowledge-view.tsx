"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, FileText, Search as SearchIcon, Upload, PenLine } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { api, fmtDate, useApi } from "./client";
import { Badge, Button, Dialog, EmptyState, ErrorBox, Field, Input, ListSkeleton, PageHeader, rowClass, RowList, Select, Textarea, useToast } from "./ui";
import type { NoteMeta } from "@/lib/notes";
import type { SearchHit } from "@/lib/search";

type Hit = Omit<SearchHit, "text">;
interface SearchResponse { hits: Hit[]; semantic: { used: boolean; reason?: string } }
interface ImportResult { filename: string; status: string; error?: string }

/** Renders FTS snippets: the server marks matches with [[ ]]; everything else is plain text (never HTML). */
function Snippet({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  text.split(/(\[\[.*?\]\])/g).forEach((p, i) => parts.push(p.startsWith("[[") ? <mark key={i}>{p.slice(2, -2)}</mark> : p));
  return <>{parts}</>;
}

function Inner({ autoFocus }: { autoFocus?: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("updated");
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(sp.get("new") === "1");
  const notes = useApi<{ notes: NoteMeta[] }>(`/api/notes?sort=${sort}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`);
  const tags = useApi<{ tags: { tag: string; count: number }[] }>("/api/tags");
  const status = useApi<{ embedModel: { name: string; installed: boolean; total: number; embedded: number } }>("/api/status");

  // follow URL changes caused by the command palette (?q=…, ?new=1)
  const qParam = sp.get("q");
  const newParam = sp.get("new");
  useEffect(() => {
    if (qParam !== null) { setQ(qParam); setQuery(qParam.trim()); }
    if (newParam === "1") {
      setNewOpen(true);
      router.replace("/knowledge"); // drop ?new=1 right away so it can never race a later navigation
    }
  }, [qParam, newParam, router]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!query) { setSearch(null); return; }
    let cancelled = false;
    setSearching(true);
    api<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`)
      .then((r) => { if (!cancelled) { setSearch(r); setSearchError(null); } })
      .catch((e) => { if (!cancelled) setSearchError(e instanceof Error ? e.message : "Search failed"); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [query]);

  async function buildIndex() {
    try {
      const r = await api<{ embedded: number; error?: string; hint?: string }>("/api/search/index", { body: {} });
      if (r.error) toast(`${r.error} ${r.hint ?? ""}`, "danger");
      else toast(`Semantic index updated (${r.embedded} passages)`);
      void status.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  const em = status.data?.embedModel;
  const needsIndex = em && em.installed && em.embedded < em.total;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Notes"
        subtitle="Plain Markdown files in your vault folder. Search by keyword or meaning."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}><Upload size={14} aria-hidden />Import files</Button>
            <Button variant="primary" onClick={() => setNewOpen(true)}><PenLine size={14} aria-hidden />New note</Button>
          </>
        }
      />
      <div className="relative mb-3">
        <SearchIcon size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <Input type="search" aria-label="Search your library" placeholder="Search notes by keyword or meaning…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} className="h-11 pl-9 lg:h-9" />
      </div>
      {em && !em.installed && (
        <p className="mb-3 flex items-start gap-2 text-xs text-faint"><Database size={13} aria-hidden className="mt-0.5 shrink-0" />Semantic search is off. To enable it run <code className="font-mono text-muted">ollama pull {em.name}</code> (about 274 MB), then build the index. Until then search is keyword-only.</p>
      )}
      {needsIndex && (
        <p className="mb-3 flex items-start gap-2 text-xs text-faint"><Database size={13} aria-hidden className="mt-0.5 shrink-0" /><span><span className="tnum">{em.total - em.embedded}</span> passage(s) are not in the semantic index. <Button size="sm" variant="secondary" onClick={() => void buildIndex()} className="ml-1 align-middle">Build semantic index</Button></span></p>
      )}

      {query ? (
        <div className="space-y-3">
          {searching && <ListSkeleton rows={3} />}
          {searchError && <ErrorBox message={searchError} />}
          {search && !searching && (
            <>
              <p className="text-xs text-faint" role="status">
                <span className="tnum">{search.hits.length}</span> result{search.hits.length === 1 ? "" : "s"} · {search.semantic.used ? "keyword + semantic retrieval" : `keyword (full-text) only${search.semantic.reason ? `: ${search.semantic.reason}` : ""}`}
              </p>
              {search.hits.length === 0 && <EmptyState icon={SearchIcon} title="No matches">Nothing in your library matched. Try fewer or different words, or ask the AI under Ask AI.</EmptyState>}
              {search.hits.length > 0 && (
                <RowList>
                  {search.hits.map((h) => (
                    <li key={`${h.noteId}:${h.chunkIndex}`}>
                      <Link href={`/knowledge/${h.noteId}`} className={`${rowClass} items-start`}>
                        <FileText size={16} aria-hidden className="mt-0.5 shrink-0 text-faint" strokeWidth={1.75} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-medium">{h.title}</p>
                          <p className="mt-0.5 text-[13px] break-words text-muted"><Snippet text={h.snippet} /></p>
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-faint">
                            <span className="font-mono">{h.path}</span>
                            {h.heading && <span>› {h.heading}</span>}
                            {h.via.map((v) => <Badge key={v} tone={v === "semantic" ? "accent" : "neutral"}>{v}</Badge>)}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </RowList>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Select aria-label="Sort notes" value={sort} onChange={(e) => setSort(e.target.value)} className="w-48">
              <option value="updated">Recently updated</option>
              <option value="created">Recently created</option>
              <option value="title">Title A–Z</option>
            </Select>
          </div>
          {(tags.data?.tags.length ?? 0) > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
              <button onClick={() => setTag("")} aria-pressed={!tag} className={`inline-flex min-h-9 items-center rounded-md border px-2.5 py-1 text-xs lg:min-h-7 ${!tag ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted hover:text-fg"}`}>All</button>
              {tags.data!.tags.slice(0, 20).map((t) => (
                <button key={t.tag} onClick={() => setTag(t.tag === tag ? "" : t.tag)} aria-pressed={tag === t.tag} className={`inline-flex min-h-9 items-center rounded-md border px-2.5 py-1 text-xs lg:min-h-7 ${tag === t.tag ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted hover:text-fg"}`}>
                  #{t.tag} <span className="tnum opacity-60">{t.count}</span>
                </button>
              ))}
            </div>
          )}
          {notes.error && <ErrorBox message={notes.error} onRetry={() => void notes.reload()} />}
          {notes.loading && !notes.data && <ListSkeleton />}
          {notes.data && notes.data.notes.length === 0 && (
            <EmptyState icon={FileText} title={tag ? `No notes tagged #${tag}` : "No notes yet"} action={!tag ? <Button variant="primary" onClick={() => setNewOpen(true)}>Write a note</Button> : undefined}>
              {tag ? "Pick another tag." : "Save an inbox capture as a note, import Markdown or PDF files, or write one here."}
            </EmptyState>
          )}
          {(notes.data?.notes.length ?? 0) > 0 && (
            <RowList>
              {notes.data!.notes.map((n) => (
                <li key={n.id}>
                  <Link href={`/knowledge/${n.id}`} className={`${rowClass} items-start`}>
                    <FileText size={16} aria-hidden className="mt-0.5 shrink-0 text-faint" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{n.title}</p>
                      {n.summary && <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{n.summary}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {n.category && <Badge>{n.category}</Badge>}
                        {n.tags.slice(0, 4).map((t) => <span key={t} className="text-xs text-faint">#{t}</span>)}
                        {n.sourceType !== "manual" && <span className="text-xs text-faint">from {n.sourceType}</span>}
                      </div>
                    </div>
                    <span className="tnum shrink-0 text-xs text-faint">{new Date(n.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </Link>
                </li>
              ))}
            </RowList>
          )}
        </>
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { void notes.reload(); void tags.reload(); void status.reload(); }} />
      <NewNoteDialog open={newOpen} onClose={() => setNewOpen(false)} onDone={() => { void notes.reload(); void tags.reload(); }} />
    </div>
  );
}

export function KnowledgeView({ autoFocus }: { autoFocus?: boolean }) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <Inner autoFocus={autoFocus} />
    </Suspense>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, [open]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const r = await api<{ results: ImportResult[] }>("/api/import", { form });
      setResults(r.results);
      setFiles([]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }
  const pick = (list: FileList | null) => setFiles(Array.from(list ?? []).filter((f) => /\.(md|markdown|txt|pdf)$/i.test(f.name)));
  const fileInput = "mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-fg";
  return (
    <Dialog open={open} onClose={() => { setResults(null); setError(null); onClose(); }} title="Import files" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={busy} disabled={!files.length} onClick={() => void run()}>Import {files.length || ""} file{files.length === 1 ? "" : "s"}</Button></>}>
      <div className="space-y-3">
        <p>Choose files or a whole folder. Only the items you select are read. Originals are copied to your <code>imports</code> folder; a Markdown note is created for each. Supported: Markdown, text, PDF with a text layer. Duplicates are skipped.</p>
        <label className="block text-sm text-fg">Files<input type="file" multiple accept=".md,.markdown,.txt,.pdf" onChange={(e) => pick(e.target.files)} className={fileInput} /></label>
        <label className="block text-sm text-fg">Or a folder<input ref={folderRef} type="file" multiple onChange={(e) => pick(e.target.files)} className={fileInput} /></label>
        {files.length > 0 && <p className="text-fg"><span className="tnum">{files.length}</span> supported file(s) selected.</p>}
        {error && <ErrorBox message={error} />}
        {results && (
          <ul className="max-h-48 space-y-1 overflow-auto text-xs">
            {results.map((r, i) => (
              <li key={i} className="flex gap-2"><Badge tone={r.status === "imported" ? "ok" : r.status === "duplicate" ? "neutral" : "danger"}>{r.status}</Badge><span className="truncate text-fg">{r.filename}</span>{r.error && <span className="text-muted">{r.error}</span>}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function NewNoteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ note: { id: string } }>("/api/notes", { body: { title, body, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      toast("Note created");
      setTitle(""); setBody(""); setTags("");
      onDone();
      onClose();
      router.push(`/knowledge/${r.note.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="New note" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void save()}>Create</Button></>}>
      <div className="space-y-3 text-fg">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Body (Markdown)"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
