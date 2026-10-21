"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, fmtDate, useApi } from "./client";
import { Badge, Button, Card, Dialog, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Textarea, useToast } from "./ui";
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

export function KnowledgeView({ autoFocus }: { autoFocus?: boolean }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const notes = useApi<{ notes: NoteMeta[] }>(`/api/notes${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`);
  const tags = useApi<{ tags: { tag: string; count: number }[] }>("/api/tags");
  const status = useApi<{ embedModel: { name: string; installed: boolean; total: number; embedded: number } }>("/api/status");

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!query) {
      setSearch(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`)
      .then((r) => !cancelled && (setSearch(r), setSearchError(null)))
      .catch((e) => !cancelled && setSearchError(e instanceof Error ? e.message : "Search failed"))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
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
        title="Knowledge"
        subtitle="Your notes are plain Markdown files in your vault folder."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>Import files</Button>
            <Button variant="primary" onClick={() => setNewOpen(true)}>New note</Button>
          </>
        }
      />
      <Input type="search" aria-label="Search your library" placeholder="Search notes by keyword or meaning…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} className="mb-3" />
      {em && !em.installed && <p className="mb-3 text-xs text-muted">Semantic search is off. To enable it: <code className="font-mono">ollama pull {em.name}</code> (about 274 MB), then build the index.</p>}
      {needsIndex && (
        <p className="mb-3 text-xs text-muted">
          {em.total - em.embedded} passage(s) are not in the semantic index. <button onClick={() => void buildIndex()} className="text-accent hover:underline">Build semantic index</button>
        </p>
      )}

      {query ? (
        <div className="space-y-3">
          {searching && <Loading label="Searching" />}
          {searchError && <ErrorBox message={searchError} />}
          {search && !searching && (
            <>
              <p className="text-xs text-muted">
                {search.hits.length} result{search.hits.length === 1 ? "" : "s"} ·{" "}
                {search.semantic.used ? "keyword + semantic" : `keyword only${search.semantic.reason ? ` (${search.semantic.reason})` : ""}`}
              </p>
              {search.hits.length === 0 && <EmptyState title="No matches">Try fewer or different words. Nothing in your library matched.</EmptyState>}
              <ul className="space-y-2">
                {search.hits.map((h) => (
                  <li key={`${h.noteId}:${h.chunkIndex}`}>
                    <Link href={`/knowledge/${h.noteId}`}>
                      <Card className="hover:border-muted">
                        <p className="font-medium">{h.title}</p>
                        <p className="mt-1 text-sm text-muted"><Snippet text={h.snippet} /></p>
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span className="font-mono">{h.path}</span>
                          {h.heading && <span>› {h.heading}</span>}
                          {h.via.map((v) => <Badge key={v} tone={v === "semantic" ? "accent" : "neutral"}>{v}</Badge>)}
                        </p>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <>
          {(tags.data?.tags.length ?? 0) > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <button onClick={() => setTag("")} className={`rounded-full border px-3 py-1 text-xs ${!tag ? "border-accent text-accent" : "border-line text-muted"}`}>All</button>
              {tags.data!.tags.slice(0, 20).map((t) => (
                <button key={t.tag} onClick={() => setTag(t.tag === tag ? "" : t.tag)} className={`rounded-full border px-3 py-1 text-xs ${tag === t.tag ? "border-accent text-accent" : "border-line text-muted hover:text-fg"}`}>
                  #{t.tag} <span className="opacity-60">{t.count}</span>
                </button>
              ))}
            </div>
          )}
          {notes.error && <ErrorBox message={notes.error} onRetry={() => void notes.reload()} />}
          {notes.loading && !notes.data && <Loading />}
          {notes.data && notes.data.notes.length === 0 && (
            <EmptyState title={tag ? `No notes tagged #${tag}` : "No notes yet"} action={!tag ? <Button variant="primary" onClick={() => setNewOpen(true)}>Write a note</Button> : undefined}>
              {tag ? "Pick another tag." : "Save an inbox capture as a note, import Markdown or PDF files, or write one here."}
            </EmptyState>
          )}
          <ul className="space-y-2">
            {notes.data?.notes.map((n) => (
              <li key={n.id}>
                <Link href={`/knowledge/${n.id}`}>
                  <Card className="hover:border-muted">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{n.title}</p>
                      {n.category && <Badge>{n.category}</Badge>}
                    </div>
                    {n.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{n.summary}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{fmtDate(n.updatedAt)}</span>
                      {n.tags.slice(0, 5).map((t) => <Badge key={t} tone="accent">#{t}</Badge>)}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { void notes.reload(); void tags.reload(); void status.reload(); }} />
      <NewNoteDialog open={newOpen} onClose={() => setNewOpen(false)} onDone={() => { void notes.reload(); void tags.reload(); }} />
    </div>
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
  return (
    <Dialog open={open} onClose={() => { setResults(null); setError(null); onClose(); }} title="Import files" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={busy} disabled={!files.length} onClick={() => void run()}>Import {files.length || ""} file{files.length === 1 ? "" : "s"}</Button></>}>
      <div className="space-y-3">
        <p>Choose files or a whole folder. Only the items you select are read. Originals are copied to your <code>imports</code> folder; a Markdown note is created for each. Supported: Markdown, text, PDF with a text layer. Duplicates are skipped.</p>
        <label className="block text-sm text-fg">Files<input type="file" multiple accept=".md,.markdown,.txt,.pdf" onChange={(e) => pick(e.target.files)} className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface2 file:px-3 file:py-2 file:text-fg" /></label>
        <label className="block text-sm text-fg">Or a folder<input ref={folderRef} type="file" multiple onChange={(e) => pick(e.target.files)} className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface2 file:px-3 file:py-2 file:text-fg" /></label>
        {files.length > 0 && <p className="text-fg">{files.length} supported file(s) selected.</p>}
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
      window.location.href = `/knowledge/${r.note.id}`;
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
