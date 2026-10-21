"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, MoreHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ProjectSquare, TaskCircle, useProjects } from "@/components/blocks";
import { api, useApi } from "@/components/client";
import { Markdown } from "@/components/markdown";
import { useNotes } from "@/components/notes/notes-context";
import { ConfirmDialog, ErrorBox, Loading, Tabs, useToast } from "@/components/ui";
import { dowDay } from "@/lib/dates";
import type { NoteConnections } from "@/lib/note-connections";
import type { Note } from "@/lib/notes";

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const eyebrow = "text-[12.5px] font-semibold text-muted";
const fieldCls = "w-full rounded-[9px] border border-line bg-surface px-3 text-fg placeholder:text-faint focus:border-accent";

function editedLabel(iso: string): string {
  const d = new Date(iso);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d >= midnight) return `Edited today ${t}`;
  const y = new Date(midnight); y.setDate(y.getDate() - 1);
  return d >= y ? `Edited yesterday ${t}` : `Edited ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const notes = useNotes();
  const { colorOf, projects: allProjects } = useProjects();
  const { data, error, loading, reload } = useApi<{ note: Note; projects: { id: string; name: string }[] }>(`/api/notes/${id}`);
  const conn = useApi<NoteConnections>(`/api/notes/${id}/connections`);
  const note = data?.note;
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [f, setF] = useState({ title: "", body: "", tags: "", category: "", summary: "" });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [linking, setLinking] = useState(false);
  const [pick, setPick] = useState("");

  useEffect(() => { setEditing(false); setMenu(false); setLinking(false); }, [id]);
  useEffect(() => { if (note) setF({ title: note.title, body: note.body, tags: note.tags.join(", "), category: note.category, summary: note.summary }); }, [note]);
  const dirty = !!note && (f.title !== note.title || f.body !== note.body || f.tags !== note.tags.join(", ") || f.category !== note.category || f.summary !== note.summary);

  const save = useCallback(async () => {
    if (!note || busy || !f.title.trim()) return;
    setBusy(true);
    try {
      await api(`/api/notes/${id}`, { method: "PATCH", body: { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      toast("Note saved", "ok");
      setEditing(false);
      void reload();
      notes.reload();
      void conn.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }, [note, busy, f, id, toast, reload, notes, conn]);

  // E edits; Ctrl/Cmd+S saves while editing; warn before leaving with unsaved changes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
      else if (!editing && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "e" && note && !note.fileMissing && !document.querySelector("dialog[open]")) { e.preventDefault(); setMode("write"); setEditing(true); }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => { if (editing && dirty) e.preventDefault(); };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("beforeunload", beforeUnload); };
  }, [editing, dirty, note, save]);

  async function link(pid: string, action: "link" | "unlink") {
    try {
      await api(`/api/projects/${pid}`, { method: "PUT", body: { note_id: id, action } });
      setPick("");
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  async function linkSimilar(title: string) {
    if (!note) return;
    try {
      await api(`/api/notes/${id}`, { method: "PATCH", body: { body: `${note.body.replace(/\s+$/, "")}\n\nRelated: [[${title}]]\n` } });
      toast(`Linked to “${title}”`, "ok");
      setLinking(false);
      void reload();
      void conn.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  async function complete(tid: string) {
    try {
      await api(`/api/tasks/${tid}`, { method: "PATCH", body: { status: "done" } });
      void conn.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  if (loading && !note) return <div className="p-6"><Loading /></div>;
  if (error || !note) return <div className="p-6"><ErrorBox message={error ?? "Note not found"} onRetry={() => void reload()} /></div>;

  const linked = new Set(data!.projects.map((p) => p.id));
  const linkable = allProjects.filter((p) => !linked.has(p.id) && p.status !== "archived");
  const folders = note.path.split("/").slice(0, -1);
  const crumb = ["VAULT", ...(folders.length ? folders : note.category ? [note.category] : []), note.path.split("/").pop() ?? ""].join(" / ");
  const c = conn.data;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap">
      <article aria-labelledby="note-title" className="flex min-w-0 flex-[999_1_460px] flex-col gap-[22px] py-1 lg:px-12 lg:py-7">
        <Link href="/knowledge" className="mb-1 flex min-h-11 items-center gap-1 self-start text-base text-muted lg:hidden"><ChevronLeft size={20} aria-hidden />Notes</Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[11.5px] tracking-[0.04em] text-faint">{crumb}</span>
          <div className="ml-auto flex gap-1.5">
            {editing ? (
              <>
                {dirty && <span role="status" className="self-center text-xs text-warn">Unsaved changes</span>}
                <button type="button" onClick={() => { setEditing(false); setF({ title: note.title, body: note.body, tags: note.tags.join(", "), category: note.category, summary: note.summary }); }} className="h-9 rounded-lg border border-line px-3 text-[12.5px] text-muted hover:bg-hover">Cancel</button>
                <button type="button" onClick={() => void save()} disabled={busy || !f.title.trim()} className="h-9 rounded-lg bg-primary px-3.5 text-[12.5px] font-semibold text-primary-fg disabled:opacity-50">Save</button>
              </>
            ) : (
              <>
                <Link href={`/ai?note=${id}`} className="flex h-9 items-center gap-1.5 rounded-lg border border-ai-line px-3 text-[12.5px] font-medium text-accent hover:bg-ai-bg"><Sparkles size={13} aria-hidden strokeWidth={1.8} />Ask about this note</Link>
                <button type="button" onClick={() => { setMode("write"); setEditing(true); }} disabled={note.fileMissing} className="flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[12.5px] hover:bg-hover disabled:opacity-50">Edit<span aria-hidden className="font-mono text-[11px] text-faint">E</span></button>
                <div className="relative">
                  <button type="button" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:bg-hover"><MoreHorizontal size={15} aria-hidden /></button>
                  {menu && (
                    <div role="menu" className="absolute right-0 z-20 mt-1 flex w-44 flex-col rounded-xl border border-line bg-surface2 p-1 shadow-2xl">
                      <button type="button" role="menuitem" onClick={() => { setMenu(false); setConfirm(true); }} className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] text-danger hover:bg-hover"><Trash2 size={14} aria-hidden />Delete…</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {note.fileMissing && <ErrorBox message="This note's Markdown file is missing from the vault." hint="Restore it from a backup or vault/.trash, then run “Reindex vault” under Settings & automations." />}

        <header className="flex max-w-[680px] flex-col gap-2.5">
          {editing ? (
            <>
              <label htmlFor="note-title" className="sr-only">Title</label>
              <input id="note-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Untitled" className="w-full border-0 bg-transparent text-[32px] leading-[1.15] font-semibold tracking-[-0.025em] text-fg outline-none placeholder:text-faint" />
            </>
          ) : (
            <h1 id="note-title" className="m-0 text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] lg:text-[32px]">{note.title}</h1>
          )}
          {editing ? (
            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-48 flex-[1_1_220px] flex-col gap-1.5"><label htmlFor="n-tags" className="text-xs text-muted">Tags (comma separated)</label><input id="n-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} className={`${fieldCls} h-9`} /></div>
              <div className="flex min-w-40 flex-[1_1_160px] flex-col gap-1.5"><label htmlFor="n-cat" className="text-xs text-muted">Category</label><input id="n-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={`${fieldCls} h-9`} /></div>
              <div className="flex w-full flex-col gap-1.5"><label htmlFor="n-sum" className="text-xs text-muted">Summary</label><textarea id="n-sum" rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className={`${fieldCls} resize-none py-2 text-[13.5px]`} /></div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {note.tags.map((t) => <span key={t} className="flex h-6 items-center rounded-md bg-surface2 px-2 font-mono text-[11.5px] text-muted">#{t}</span>)}
              {data!.projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex h-6 items-center gap-1.5 rounded-md bg-surface2 px-2 text-xs text-muted hover:text-fg"><ProjectSquare color={colorOf(p.id)} size={7} />{p.name}</Link>
              ))}
              <span className="font-mono text-[11.5px] text-faint">{editedLabel(note.updatedAt)} · {words(note.body)} words · vault/{note.path}</span>
            </div>
          )}
        </header>

        {!editing && note.summary && <p className="m-0 max-w-[680px] border-l-2 border-accent pl-4 text-[15px] leading-relaxed text-muted">{note.summary}</p>}

        <div className="max-w-[680px]">
          {editing ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <Tabs label="Editor mode" value={mode} onChange={setMode} tabs={[{ id: "write", label: "Write" }, { id: "preview", label: "Preview" }]} />
                <span className="hidden items-center gap-1 text-xs text-faint sm:flex">Markdown · <kbd className="kbd">Ctrl</kbd><kbd className="kbd">S</kbd> to save</span>
              </div>
              {mode === "write" ? (
                <textarea aria-label="Note body (Markdown)" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={22} placeholder="Write in Markdown…" className={`${fieldCls} min-h-[24rem] bg-transparent py-3 font-mono text-[14px] leading-7`} />
              ) : (
                <div className="min-h-[24rem] rounded-[9px] border border-line p-4">{f.body.trim() ? <Markdown source={f.body} wiki={notes.resolveTitle} /> : <p className="text-faint">Nothing to preview.</p>}</div>
              )}
            </div>
          ) : note.body.trim() ? (
            <div className="text-[15.5px] leading-[1.7]"><Markdown source={note.body} wiki={notes.resolveTitle} /></div>
          ) : (
            <p className="text-faint">This note is empty. Press E to start writing.</p>
          )}
        </div>
      </article>

      {/* ---------- connections ---------- */}
      <aside aria-label="Connections" className="flex min-w-0 flex-[1_1_250px] flex-col gap-6 border-t border-line py-6 lg:max-w-[300px] lg:border-t-0 lg:border-l lg:px-5 lg:py-7">
        <section aria-labelledby="bl-h" className="flex flex-col gap-1.5">
          <h2 id="bl-h" className={`${eyebrow} mb-1`}>Linked from · {c?.linkedFrom.length ?? 0}</h2>
          {c && c.linkedFrom.length === 0 && <p className="m-0 text-[12.5px] text-faint">No other note links here yet. Write [[{note.title}]] in one to link it.</p>}
          {c?.linkedFrom.map((l) => (
            <Link key={l.id} href={`/knowledge/${l.id}`} className="flex flex-col gap-0.5 rounded-[9px] bg-surface px-2.5 py-2 hover:bg-hover/60">
              <span className="text-[13px]">{l.title}</span>
              <span className="line-clamp-2 text-xs text-faint">“{l.snippet}”</span>
            </Link>
          ))}
        </section>

        <section aria-labelledby="tk-h" className="flex flex-col gap-1.5">
          <h2 id="tk-h" className={`${eyebrow} mb-1`}>Tasks · {c?.tasks.length ?? 0}</h2>
          {c && c.tasks.length === 0 && <p className="m-0 text-[12.5px] text-faint">No tasks came from this note.</p>}
          {c?.tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-1 rounded-[9px] bg-surface py-0.5 pr-2.5 pl-1">
              <TaskCircle label={t.status === "done" ? `Done: ${t.title}` : `Complete: ${t.title}`} done={t.status === "done"} onClick={() => t.status !== "done" && void complete(t.id)} />
              <span className={`flex-1 text-[13px] ${t.status === "done" ? "text-faint line-through" : ""}`}>{t.title}</span>
              {t.due_date && <span className="font-mono text-[11px] text-faint">{dowDay(t.due_date).split(" ")[0]}</span>}
            </div>
          ))}
        </section>

        <section aria-labelledby="rel-h" className="flex flex-col gap-1.5">
          <div className="mb-1 flex items-center gap-2">
            <h2 id="rel-h" className={`m-0 ${eyebrow}`}>Similar in meaning</h2>
            {c?.semantic && <span className="rounded-[5px] bg-ai-bg px-1.5 py-px font-mono text-[10.5px] text-accent">semantic</span>}
          </div>
          {c && c.similar.length === 0 && <p className="m-0 text-[12.5px] text-faint">Nothing similar found yet.</p>}
          {c?.similar.map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <Link href={`/knowledge/${s.id}`} className="flex min-h-9 flex-1 items-center rounded-lg px-2.5 text-[13px] hover:bg-hover/60">{s.title}</Link>
              {linking && <button type="button" onClick={() => void linkSimilar(s.title)} aria-label={`Link to ${s.title}`} className="h-8 rounded-md border border-ai-line px-2 text-xs text-accent hover:bg-ai-bg">Link</button>}
            </div>
          ))}
          {c && c.similar.length > 0 && (
            <button type="button" aria-pressed={linking} onClick={() => setLinking((v) => !v)} className="mt-1 h-9 self-start rounded-lg border border-dashed border-ai-line px-3 text-xs font-medium text-accent hover:bg-ai-bg">{linking ? "Done linking" : "Link one of these"}</button>
          )}
        </section>

        <section aria-labelledby="pj-h" className="flex flex-col gap-1.5">
          <h2 id="pj-h" className={`${eyebrow} mb-1`}>Projects</h2>
          <div className="flex flex-wrap gap-1.5">
            {data!.projects.map((p) => (
              <span key={p.id} className="flex h-7 items-center gap-1.5 rounded-md bg-surface2 pr-1 pl-2 text-xs text-muted">
                <ProjectSquare color={colorOf(p.id)} size={7} />{p.name}
                <button type="button" aria-label={`Unlink from ${p.name}`} onClick={() => void link(p.id, "unlink")} className="grid size-6 place-items-center rounded text-faint hover:text-danger"><X size={12} aria-hidden /></button>
              </span>
            ))}
            {data!.projects.length === 0 && <span className="text-[12.5px] text-faint">Not linked to a project.</span>}
          </div>
          {linkable.length > 0 && (
            <div className="flex gap-1.5">
              <label htmlFor="pj-pick" className="sr-only">Project to link</label>
              <select id="pj-pick" value={pick} onChange={(e) => setPick(e.target.value)} className={`${fieldCls} h-9 min-w-0 flex-1 text-xs`}>
                <option value="">Link to a project…</option>
                {linkable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" disabled={!pick} onClick={() => void link(pick, "link")} className="h-9 rounded-lg border border-line px-3 text-xs hover:bg-hover disabled:opacity-50">Link</button>
            </div>
          )}
        </section>
      </aside>

      <ConfirmDialog
        open={confirm}
        title="Delete this note?"
        message="The note is removed from the library. Its Markdown file is moved to vault/.trash so you can still recover it."
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await api(`/api/notes/${id}`, { method: "DELETE" });
            toast("Note deleted", "ok");
            notes.reload();
            router.push("/knowledge");
          } catch (e) {
            toast(e instanceof Error ? e.message : "Failed", "danger");
            setConfirm(false);
          }
        }}
      />
    </div>
  );
}
