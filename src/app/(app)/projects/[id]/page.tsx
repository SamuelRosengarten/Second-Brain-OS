"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtDate, useApi } from "@/components/client";
import { NewTask, TaskRow } from "@/components/task-list";
import { Badge, Button, Card, CardTitle, ConfirmDialog, ErrorBox, Field, Input, Loading, Select, Textarea, useToast } from "@/components/ui";
import type { Project, Task } from "@/lib/projects";

interface Detail {
  project: Project;
  tasks: Task[];
  notes: { id: string; title: string; category: string; updated_at: string }[];
  activity: { kind: string; message: string; created_at: string }[];
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Detail>(`/api/projects/${id}`);
  const allNotes = useApi<{ notes: { id: string; title: string }[] }>("/api/notes?limit=500");
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: "", description: "", goals: "", status: "active", target_date: "" });
  const [confirm, setConfirm] = useState(false);
  const [pick, setPick] = useState("");

  useEffect(() => {
    if (data) setF({ name: data.project.name, description: data.project.description, goals: data.project.goals, status: data.project.status, target_date: data.project.target_date ?? "" });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Project not found"} onRetry={() => void reload()} />;
  const p = data.project;

  async function save() {
    try {
      await api(`/api/projects/${id}`, { method: "PATCH", body: { ...f, target_date: f.target_date || null } });
      toast("Project updated");
      setEdit(false);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  async function noteLink(noteId: string, action: "link" | "unlink") {
    try {
      await api(`/api/projects/${id}`, { method: "PUT", body: { note_id: noteId, action } });
      setPick("");
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  const linked = new Set(data.notes.map((n) => n.id));
  const linkable = (allNotes.data?.notes ?? []).filter((n) => !linked.has(n.id));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-muted hover:text-fg">← Projects</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <Badge tone={p.status === "active" ? "ok" : "neutral"}>{p.status}</Badge>
          {p.target_date && <span className="text-sm text-muted">Target {p.target_date}</span>}
        </div>
      </div>

      <Card>
        {edit ? (
          <div className="space-y-4">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Goals"><Textarea rows={3} value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                  {["planned", "active", "paused", "done", "archived"].map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="Target date"><Input type="date" value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} /></Field>
            </div>
            <div className="flex gap-2"><Button variant="primary" disabled={!f.name.trim()} onClick={() => void save()}>Save</Button><Button variant="ghost" onClick={() => setEdit(false)}>Cancel</Button></div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {p.description ? <p>{p.description}</p> : <p className="text-muted">No description.</p>}
            <div><p className="text-xs font-semibold tracking-wide text-muted uppercase">Goals</p><p className="whitespace-pre-wrap">{p.goals || <span className="text-muted">None set.</span>}</p></div>
            <div className="flex gap-2"><Button onClick={() => setEdit(true)}>Edit</Button><Button variant="danger" onClick={() => setConfirm(true)}>Delete…</Button></div>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Tasks</CardTitle>
        <NewTask projectId={id} onCreated={() => void reload()} />
        {data.tasks.length === 0 ? <p className="mt-3 text-sm text-muted">No tasks yet.</p> : <ul className="mt-2 divide-y divide-line">{data.tasks.map((t) => <TaskRow key={t.id} task={t} onChange={() => void reload()} />)}</ul>}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>Related notes</CardTitle>
          {data.notes.length === 0 && <p className="mb-3 text-sm text-muted">No linked notes.</p>}
          <ul className="mb-3 space-y-1">
            {data.notes.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/knowledge/${n.id}`} className="truncate hover:text-accent">{n.title}</Link>
                <button aria-label={`Unlink ${n.title}`} onClick={() => void noteLink(n.id, "unlink")} className="text-muted hover:text-danger">×</button>
              </li>
            ))}
          </ul>
          {linkable.length > 0 && (
            <div className="flex gap-2">
              <Select aria-label="Note to link" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Link a note…</option>
                {linkable.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
              </Select>
              <Button disabled={!pick} onClick={() => void noteLink(pick, "link")}>Link</Button>
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>Activity</CardTitle>
          <ul className="space-y-2 text-sm">
            {data.activity.map((a, i) => (
              <li key={i} className="flex justify-between gap-3"><span>{a.message}</span><span className="shrink-0 text-xs text-muted">{fmtDate(a.created_at)}</span></li>
            ))}
          </ul>
        </Card>
      </div>

      <ConfirmDialog open={confirm} title="Delete this project?" message="Tasks stay in your task list but are unlinked from this project. Notes are not deleted." onCancel={() => setConfirm(false)} onConfirm={async () => {
        try {
          await api(`/api/projects/${id}`, { method: "DELETE" });
          router.push("/projects");
        } catch (e) {
          toast(e instanceof Error ? e.message : "Failed", "danger");
          setConfirm(false);
        }
      }} />
    </div>
  );
}
