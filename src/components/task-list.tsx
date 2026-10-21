"use client";
import { useState } from "react";
import { api } from "./client";
import { Badge, Button, Input, Select, useToast } from "./ui";
import type { Task } from "@/lib/projects";

const PRIORITY_TONE = { high: "danger", medium: "neutral", low: "neutral" } as const;

export function TaskRow({ task, projectName, onChange }: { task: Task; projectName?: string; onChange: () => void }) {
  const toast = useToast();
  const done = task.status === "done";
  async function patch(body: object) {
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body });
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  const overdue = !done && task.due_date && task.due_date < new Date().toLocaleDateString("sv");
  return (
    <li className="flex items-start gap-3 py-2.5">
      <button aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`} aria-pressed={done} onClick={() => void patch({ status: done ? "todo" : "done" })} className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] ${done ? "border-ok bg-ok text-accent-fg" : "border-muted hover:border-accent"}`}>
        {done ? "✓" : ""}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? "text-muted line-through" : ""}`}>{task.title}</p>
        {task.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{task.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
          {task.status === "doing" && <Badge tone="accent">in progress</Badge>}
          {task.due_date && <Badge tone={overdue ? "danger" : "neutral"}>{overdue ? "overdue · " : "due "}{task.due_date}</Badge>}
          {projectName && <Badge>{projectName}</Badge>}
        </div>
      </div>
      {!done && task.status !== "doing" && <Button size="sm" variant="ghost" onClick={() => void patch({ status: "doing" })}>Start</Button>}
      <Button size="sm" variant="ghost" aria-label={`Delete ${task.title}`} onClick={async () => {
        try {
          await api(`/api/tasks/${task.id}`, { method: "DELETE" });
          onChange();
        } catch (e) {
          toast(e instanceof Error ? e.message : "Failed", "danger");
        }
      }}>✕</Button>
    </li>
  );
}

export function NewTask({ projectId, projects, onCreated }: { projectId?: string; projects?: { id: string; name: string }[]; onCreated: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [due, setDue] = useState("");
  const [project, setProject] = useState(projectId ?? "");
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api("/api/tasks", { body: { title, priority, due_date: due || null, project_id: project || null } });
      setTitle("");
      setDue("");
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={add} className="flex flex-wrap gap-2">
      <Input aria-label="New task title" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-48 flex-1" />
      <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-28">
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </Select>
      <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
      {!projectId && projects && (
        <Select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="w-40">
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>Add</Button>
    </form>
  );
}
