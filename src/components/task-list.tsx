"use client";
import { Circle, CircleCheck, Flag, FolderKanban, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import { Badge, Button, cx, IconButton, Input, Select, useToast } from "./ui";
import type { Task } from "@/lib/projects";

const PRIORITY: Record<Task["priority"], { label: string; cls: string }> = {
  high: { label: "High", cls: "text-danger" },
  medium: { label: "Medium", cls: "text-warn" },
  low: { label: "Low", cls: "text-faint" },
};

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
  const today = new Date().toLocaleDateString("sv");
  const overdue = !done && !!task.due_date && task.due_date < today;
  const isToday = !done && task.due_date === today;
  return (
    <li className="group flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover/60">
      <button
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        aria-pressed={done}
        onClick={() => void patch({ status: done ? "todo" : "done" })}
        className={cx("grid size-10 shrink-0 place-items-center rounded-full lg:size-6", done ? "text-ok" : "text-faint hover:text-ok")}
      >
        {done ? <CircleCheck size={18} aria-hidden strokeWidth={1.75} /> : <Circle size={18} aria-hidden strokeWidth={1.5} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cx("truncate text-[13.5px]", done && "text-faint line-through")}>{task.title}</p>
        {task.description && <p className="truncate text-xs text-faint">{task.description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {projectName && <span className="hidden items-center gap-1 text-xs text-faint sm:flex"><FolderKanban size={12} aria-hidden />{projectName}</span>}
        {!done && task.priority !== "medium" && (
          <span className={cx("flex items-center gap-1 text-xs", PRIORITY[task.priority].cls)} title={`${PRIORITY[task.priority].label} priority`}>
            <Flag size={12} aria-hidden />
            <span className="hidden sm:inline">{PRIORITY[task.priority].label}</span>
            <span className="sr-only sm:hidden">{PRIORITY[task.priority].label} priority</span>
          </span>
        )}
        {task.status === "doing" && <Badge tone="info">In progress</Badge>}
        {task.due_date && (overdue ? <Badge tone="danger">Overdue · <span className="tnum">{task.due_date}</span></Badge> : isToday ? <Badge tone="accent">Today</Badge> : <span className="tnum text-xs text-faint">{task.due_date}</span>)}
        {!done && task.status !== "doing" && <IconButton icon={Play} label={`Start ${task.title}`} onClick={() => void patch({ status: "doing" })} className="lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100" />}
        <IconButton
          icon={Trash2}
          label={`Delete ${task.title}`}
          className="lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          onClick={async () => {
            try {
              await api(`/api/tasks/${task.id}`, { method: "DELETE" });
              onChange();
            } catch (e) {
              toast(e instanceof Error ? e.message : "Failed", "danger");
            }
          }}
        />
      </div>
    </li>
  );
}

export function NewTask({ projectId, projects, onCreated, autoFocus }: { projectId?: string; projects?: { id: string; name: string }[]; onCreated: () => void; autoFocus?: boolean }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [due, setDue] = useState("");
  const [project, setProject] = useState(projectId ?? "");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api("/api/tasks", { body: { title, priority, due_date: due || null, project_id: project || null } });
      setTitle("");
      setDue("");
      onCreated();
      ref.current?.focus();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={add} className="flex flex-wrap gap-2">
      <Input ref={ref} aria-label="New task title" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-48 flex-1" />
      <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-28">
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </Select>
      <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40 tnum" />
      {!projectId && projects && (
        <Select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="w-40">
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}><Plus size={14} aria-hidden />Add</Button>
    </form>
  );
}
