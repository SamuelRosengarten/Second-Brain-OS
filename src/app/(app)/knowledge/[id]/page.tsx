"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Calendar, Eye, FileText, FolderKanban, Link2, Pencil, Save, Tag, Trash2, Layers, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtDate, useApi } from "@/components/client";
import { Markdown } from "@/components/markdown";
import { Badge, Button, ConfirmDialog, ErrorBox, Input, Loading, Property, Select, Tabs, Textarea, useToast } from "@/components/ui";
import type { Note } from "@/lib/notes";
import type { Project } from "@/lib/projects";

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ note: Note; projects: { id: string; name: string }[] }>(`/api/notes/${id}`);
  const allProjects = useApi<{ projects: Project[] }>("/api/projects");
  const note = data?.note;
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [f, setF] = useState({ title: "", body: "", tags: "", category: "", summary: "" });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pick, setPick] = useState("");

  useEffect(() => {
    if (note) setF({ title: note.title, body: note.body, tags: note.tags.join(", "), category: note.category, summary: note.summary });
  }, [note]);

  const dirty = !!note && (f.title !== note.title || f.body !== note.body || f.tags !== note.tags.join(", ") || f.category !== note.category || f.summary !== note.summary);

  async function save() {
    if (!note || busy || !f.title.trim()) return;
    setBusy(true);
    try {
      await api(`/api/notes/${id}`, { method: "PATCH", body: { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      toast("Note saved");
      setEditing(false);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }
  // Ctrl/Cmd+S saves while editing; warn before leaving with unsaved changes.
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !note) return <Loading />;
  if (error || !note) return <ErrorBox message={error ?? "Note not found"} onRetry={() => void reload()} />;

  async function link(pid: string, action: "link" | "unlink") {
    try {
      await api(`/api/projects/${pid}`, { method: "PUT", body: { note_id: id, action } });
      setPick("");
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  const linked = new Set(data!.projects.map((p) => p.id));
  const linkable = (allProjects.data?.projects ?? []).filter((p) => !linked.has(p.id) && p.status !== "archived");
  const cancel = () => {
    setEditing(false);
    setF({ title: note.title, body: note.body, tags: note.tags.join(", "), category: note.category, summary: note.summary });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center justify-between gap-3 text-xs text-faint">
        <span className="flex min-w-0 items-center gap-1.5"><Link href="/knowledge" className="hover:text-fg">Notes</Link><span aria-hidden>/</span><span className="truncate" aria-current="page">{note.title}</span></span>
        <span className="flex shrink-0 items-center gap-2">
          {editing ? (
            <>
              {dirty && <span className="text-warn" role="status">Unsaved changes</span>}
              <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!f.title.trim()} onClick={() => void save()}><Save size={13} aria-hidden />Save</Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => { setMode("write"); setEditing(true); }} disabled={note.fileMissing}><Pencil size={13} aria-hidden />Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Delete note"><Trash2 size={13} aria-hidden />Delete…</Button>
            </>
          )}
        </span>
      </nav>

      {note.fileMissing && <div className="mb-4"><ErrorBox message="This note's Markdown file is missing from the vault." hint="Restore it from a backup or vault/.trash, then run “Reindex vault” under Automations." /></div>}

      {/* title */}
      {editing ? (
        <input aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="mb-4 w-full border-0 bg-transparent text-[1.9rem] leading-tight font-bold tracking-tight text-fg outline-none placeholder:text-faint" placeholder="Untitled" />
      ) : (
        <h1 className="mb-4 text-[1.9rem] leading-tight font-bold tracking-tight">{note.title}</h1>
      )}

      {/* properties */}
      <dl className="mb-6 border-y border-line py-2">
        <Property icon={Tag} label="Tags">
          {editing ? <Input aria-label="Tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="comma, separated" /> : note.tags.length ? <span className="flex flex-wrap gap-1.5">{note.tags.map((t) => <Badge key={t} tone="accent">#{t}</Badge>)}</span> : <span className="text-faint">None</span>}
        </Property>
        <Property icon={Layers} label="Category">
          {editing ? <Input aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /> : note.category || <span className="text-faint">None</span>}
        </Property>
        <Property icon={Link2} label="Source">
          {/^https?:\/\//.test(note.sourceRef) ? <a href={note.sourceRef} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{note.sourceRef}</a> : <span>{note.sourceRef || note.sourceType}</span>}
          <span className="ml-2 text-xs text-faint">{note.sourceType}</span>
        </Property>
        <Property icon={Calendar} label="Updated"><span className="tnum">{fmtDate(note.updatedAt)}</span></Property>
        <Property icon={FileText} label="File"><code className="font-mono text-xs text-muted">vault/{note.path}</code></Property>
        <Property icon={FolderKanban} label="Projects">
          <div className="flex flex-wrap items-center gap-1.5">
            {data!.projects.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs">
                <Link href={`/projects/${p.id}`} className="hover:text-accent">{p.name}</Link>
                <button aria-label={`Unlink from ${p.name}`} onClick={() => void link(p.id, "unlink")} className="text-faint hover:text-danger"><X size={12} aria-hidden /></button>
              </span>
            ))}
            {data!.projects.length === 0 && linkable.length === 0 && <span className="text-faint">None. Create a project first.</span>}
            {linkable.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Select aria-label="Project to link" value={pick} onChange={(e) => setPick(e.target.value)} className="h-7 w-40 text-xs lg:h-7">
                  <option value="">Link to a project…</option>
                  {linkable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Button size="sm" disabled={!pick} onClick={() => void link(pick, "link")}>Link</Button>
              </span>
            )}
          </div>
        </Property>
      </dl>

      {/* summary */}
      {editing ? (
        <div className="mb-6">
          <label className="mb-1 block text-xs font-medium text-faint" htmlFor="sum">Summary</label>
          <Textarea id="sum" rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className="min-h-0" />
        </div>
      ) : (
        note.summary && <p className="mb-6 border-l-2 border-accent pl-4 text-[15px] leading-relaxed text-muted">{note.summary}</p>
      )}

      {/* body */}
      {editing ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <Tabs label="Editor mode" value={mode} onChange={setMode} tabs={[{ id: "write", label: "Write" }, { id: "preview", label: "Preview" }]} />
            <span className="hidden items-center gap-1 text-xs text-faint sm:flex"><Eye size={12} aria-hidden />Markdown · <kbd className="kbd">Ctrl</kbd><kbd className="kbd">S</kbd> to save</span>
          </div>
          {mode === "write" ? (
            <Textarea aria-label="Note body (Markdown)" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={22} className="min-h-[24rem] border-line/60 bg-transparent font-mono text-[14px] leading-7" placeholder="Write in Markdown…" />
          ) : (
            <div className="min-h-[24rem] rounded-md border border-line/60 p-4">{f.body.trim() ? <Markdown source={f.body} /> : <p className="text-faint">Nothing to preview.</p>}</div>
          )}
        </div>
      ) : note.body.trim() ? (
        <Markdown source={note.body} />
      ) : (
        <p className="text-faint">This note is empty. Press Edit to start writing.</p>
      )}

      <ConfirmDialog
        open={confirm}
        title="Delete this note?"
        message="The note is removed from the library. Its Markdown file is moved to vault/.trash so you can still recover it."
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await api(`/api/notes/${id}`, { method: "DELETE" });
            toast("Note deleted");
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
