"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtDate, useApi } from "@/components/client";
import { Badge, Button, Card, CardTitle, ConfirmDialog, ErrorBox, Field, Input, Loading, Select, Textarea, useToast } from "@/components/ui";
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
  const [f, setF] = useState({ title: "", body: "", tags: "", category: "", summary: "" });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pick, setPick] = useState("");

  useEffect(() => {
    if (note) setF({ title: note.title, body: note.body, tags: note.tags.join(", "), category: note.category, summary: note.summary });
  }, [note]);

  if (loading && !note) return <Loading />;
  if (error || !note) return <ErrorBox message={error ?? "Note not found"} onRetry={() => void reload()} />;

  async function save() {
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/knowledge" className="text-sm text-muted hover:text-fg">← Knowledge</Link>
        {!editing && <h1 className="mt-2 text-2xl font-semibold tracking-tight">{note.title}</h1>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Updated {fmtDate(note.updatedAt)}</span>
          {note.category && <Badge>{note.category}</Badge>}
          {note.tags.map((t) => <Badge key={t} tone="accent">#{t}</Badge>)}
        </div>
        <p className="mt-1 text-xs text-muted">Source: {note.sourceRef || note.sourceType} · File: <code className="font-mono">vault/{note.path}</code></p>
      </div>
      {note.fileMissing && <ErrorBox message="This note's Markdown file is missing from the vault." hint="Restore it from a backup or the vault/.trash folder, then run Reindex under Automations." />}

      {editing ? (
        <Card className="space-y-4">
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Summary"><Textarea rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
            <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
          </div>
          <Field label="Body (Markdown)"><Textarea rows={16} className="font-mono text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="flex gap-2">
            <Button variant="primary" loading={busy} disabled={!f.title.trim()} onClick={() => void save()}>Save</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); if (note) setF({ title: note.title, body: note.body, tags: note.tags.join(", "), category: note.category, summary: note.summary }); }}>Cancel</Button>
          </div>
        </Card>
      ) : (
        <Card>
          {note.summary && <p className="mb-4 border-l-2 border-accent pl-3 text-sm text-muted">{note.summary}</p>}
          {/* Rendered as preformatted text on purpose: no HTML/Markdown rendering means imported content can never inject markup. */}
          <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">{note.body || "(empty note)"}</pre>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setEditing(true)} disabled={note.fileMissing}>Edit</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>Delete…</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Projects</CardTitle>
        {data!.projects.length === 0 && <p className="mb-3 text-sm text-muted">Not linked to any project.</p>}
        <ul className="mb-3 flex flex-wrap gap-2">
          {data!.projects.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-lg border border-line px-3 py-1 text-sm">
              <Link href={`/projects/${p.id}`} className="hover:text-accent">{p.name}</Link>
              <button aria-label={`Unlink from ${p.name}`} onClick={() => void link(p.id, "unlink")} className="ml-1 text-muted hover:text-danger">×</button>
            </li>
          ))}
        </ul>
        {linkable.length > 0 && (
          <div className="flex gap-2">
            <Select aria-label="Project to link" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Link to a project…</option>
              {linkable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Button disabled={!pick} onClick={() => void link(pick, "link")}>Link</Button>
          </div>
        )}
        {linkable.length === 0 && data!.projects.length === 0 && <p className="text-xs text-muted">Create a project first under Projects.</p>}
      </Card>

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
