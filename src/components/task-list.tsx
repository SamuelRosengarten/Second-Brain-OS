"use client";
import { CalendarClock, Circle, CircleCheck, Flag, FolderKanban, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, localToday } from "./client";
import { Badge, Button, cx, Dialog, Field, IconButton, Input, Select, Textarea, useToast } from "./ui";
import { addDays } from "@/lib/dates";
import type { Task } from "@/lib/projects";

const PRIORITY: Record<Task["priority"], { label: string; cls: string }> = {
  high: { label: "High", cls: "text-danger" },
  medium: { label: "Medium", cls: "text-warn" },
  low: { label: "Low", cls: "text-faint" },
};

type ProjectOption = { id: string; name: string };

export function TaskRow({ task, projectName, projects, onChange }: { task: Task; projectName?: string; projects?: ProjectOption[]; onChange: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const done = task.status === "done";
  async function patch(body: object) {
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body });
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  /** Moves the due date and offers to put it back. */
  async function snooze(to: string) {
    const from = task.due_date;
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { due_date: to } });
      onChange();
      toast("Moved to tomorrow", "ok", {
        label: "Undo",
        onClick: () => void api(`/api/tasks/${task.id}`, { method: "PATCH", body: { due_date: from } }).then(onChange, () => toast("Could not undo", "danger")),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  /** Moves the task to the trash (kept 30 days). Undo restores the very same task, id and dates included. */
  async function remove() {
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      onChange();
      toast("Task moved to trash", "ok", {
        label: "Undo",
        onClick: () => void api(`/api/tasks/${task.id}/restore`, { body: {} }).then(onChange, () => toast("Could not restore the task", "danger")),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  const today = localToday();
  const overdue = !done && !!task.due_date && task.due_date < today;
  const isToday = !done && task.due_date === today;
  return (
    // Phone: the title gets its own line and the badges/actions sit under it. From `sm` up everything is one row.
    <li className="group flex flex-wrap items-center gap-x-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover/60 sm:flex-nowrap">
      <button
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        aria-pressed={done}
        onClick={() => void patch({ status: done ? "todo" : "done" })}
        className={cx("grid size-10 shrink-0 place-items-center rounded-full lg:size-6", done ? "text-ok" : "text-faint hover:text-ok")}
      >
        {done ? <CircleCheck size={18} aria-hidden strokeWidth={1.75} /> : <Circle size={18} aria-hidden strokeWidth={1.5} />}
      </button>
      <button type="button" onClick={() => setEditing(true)} title="Edit task" className="min-h-10 min-w-0 flex-1 rounded-md text-left lg:min-h-0">
        <span className={cx("block truncate text-[13.5px]", done && "text-faint line-through")}>{task.title}</span>
        {task.description && <span className="block truncate text-xs text-faint">{task.description}</span>}
      </button>
      <div className="flex w-full min-w-0 items-center gap-2 pb-0.5 pl-[3.25rem] sm:w-auto sm:shrink-0 sm:pb-0 sm:pl-0">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-none">
          {projectName && <span className="hidden items-center gap-1 text-xs text-faint sm:flex"><FolderKanban size={12} aria-hidden />{projectName}</span>}
          {!done && task.priority !== "medium" && (
            <span className={cx("flex items-center gap-1 text-xs", PRIORITY[task.priority].cls)} title={`${PRIORITY[task.priority].label} priority`}>
              <Flag size={12} aria-hidden />
              <span className="hidden sm:inline">{PRIORITY[task.priority].label}</span>
              <span className="sr-only sm:hidden">{PRIORITY[task.priority].label} priority</span>
            </span>
          )}
          {task.status === "doing" && <Badge tone="info">In progress</Badge>}
          {task.due_date && (overdue ? <Badge tone="danger">Overdue · <span className="tnum"><span className="sm:hidden">{task.due_date.slice(5)}</span><span className="hidden sm:inline">{task.due_date}</span></span></Badge> : isToday ? <Badge tone="accent">Today</Badge> : <span className="tnum text-xs text-faint">{task.start_date && task.start_date !== task.due_date ? `${task.start_date} → ${task.due_date}` : task.due_date}</span>)}
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {(overdue || isToday) && <IconButton icon={CalendarClock} label={`Move ${task.title} to tomorrow`} onClick={() => void snooze(addDays(today, 1))} />}
          {!done && task.status !== "doing" && <IconButton icon={Play} label={`Start ${task.title}`} onClick={() => void patch({ status: "doing" })} className="lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100" />}
          <IconButton icon={Trash2} label={`Delete ${task.title}`} className="lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100" onClick={() => void remove()} />
        </div>
      </div>
      {editing && <TaskEditDialog task={task} projects={projects} onClose={() => setEditing(false)} onSaved={onChange} />}
    </li>
  );
}

export function TaskEditDialog({ task, projects, onClose, onSaved }: { task: Task; projects?: ProjectOption[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const formId = useId();
  const [f, setF] = useState({ title: task.title, description: task.description, status: task.status, priority: task.priority, start: task.start_date ?? "", due: task.due_date ?? "", project: task.project_id ?? "" });
  const [busy, setBusy] = useState(false);
  const today = localToday();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: { title: f.title, description: f.description, status: f.status, priority: f.priority, start_date: f.start || null, due_date: f.due || null, ...(projects ? { project_id: f.project || null } : {}) },
      });
      toast("Task updated");
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "danger");
      setBusy(false);
    }
  }
  const quick: { label: string; value: string }[] = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "Next week", value: addDays(today, 7) },
    { label: "No date", value: "" },
  ];
  return (
    <Dialog
      open
      noKeyboardOnTouch
      onClose={onClose}
      title="Edit task"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!f.title.trim()}>Save</Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="space-y-3">
        <Field label="Title"><Input value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.description} maxLength={5000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Task["status"] })}>
              <option value="todo">To do</option>
              <option value="doing">In progress</option>
              <option value="done">Done</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task["priority"] })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
        </div>
        <Field label="Start date"><Input type="date" value={f.start} max={f.due || undefined} onChange={(e) => setF({ ...f, start: e.target.value })} className="tnum" /></Field>
        <Field label="Due date"><Input type="date" value={f.due} min={f.start || undefined} onChange={(e) => setF({ ...f, due: e.target.value })} className="tnum" /></Field>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick due dates">
          {quick.map((q) => (
            <Button key={q.label} size="sm" variant={f.due === q.value ? "primary" : "secondary"} aria-pressed={f.due === q.value} onClick={() => setF({ ...f, due: q.value })}>{q.label}</Button>
          ))}
        </div>
        {projects && (
          <Field label="Project">
            <Select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
      </form>
    </Dialog>
  );
}

export function NewTask({ projectId, projects, onCreated, autoFocus }: { projectId?: string; projects?: { id: string; name: string }[]; onCreated: () => void; autoFocus?: boolean }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [start, setStart] = useState("");
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
      await api("/api/tasks", { body: { title, priority, start_date: start || null, due_date: due || null, project_id: project || null } });
      setTitle("");
      setStart("");
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
      <Input aria-label="Start date" type="date" value={start} max={due || undefined} onChange={(e) => setStart(e.target.value)} className="w-40 tnum" />
      <Input aria-label="Due date" type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className="w-40 tnum" />
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
