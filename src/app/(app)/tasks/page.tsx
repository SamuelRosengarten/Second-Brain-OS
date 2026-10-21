"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApi } from "@/components/client";
import { NewTask, TaskRow } from "@/components/task-list";
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Select } from "@/components/ui";
import type { Project, Task } from "@/lib/projects";

function Tasks() {
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") ?? "open");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState(sp.get("due") ?? "");
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (priority) qs.set("priority", priority);
  if (due) qs.set("due", due);
  const { data, error, loading, reload } = useApi<{ tasks: Task[] }>(`/api/tasks?${qs}`);
  const projects = useApi<{ projects: Project[] }>("/api/projects");
  const names = new Map((projects.data?.projects ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Tasks" subtitle="Simple, personal, no ceremony." />
      <Card className="mb-4"><NewTask projects={(projects.data?.projects ?? []).filter((p) => p.status !== "archived")} onCreated={() => void reload()} /></Card>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="open">Open</option>
          <option value="todo">To do</option>
          <option value="doing">In progress</option>
          <option value="done">Done</option>
          <option value="">All</option>
        </Select>
        <Select aria-label="Priority filter" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-36">
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select aria-label="Due filter" value={due} onChange={(e) => setDue(e.target.value)} className="w-40">
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="soon">Due in 7 days</option>
        </Select>
      </div>
      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading />}
      {data && data.tasks.length === 0 && <EmptyState title="No tasks here">{status === "open" && !priority && !due ? "Add your first task above, or turn an inbox suggestion into one." : "No tasks match these filters."}</EmptyState>}
      {data && data.tasks.length > 0 && (
        <Card className="py-1">
          <ul className="divide-y divide-line">
            {data.tasks.map((t) => <TaskRow key={t.id} task={t} projectName={t.project_id ? names.get(t.project_id) : undefined} onChange={() => void reload()} />)}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Tasks />
    </Suspense>
  );
}
