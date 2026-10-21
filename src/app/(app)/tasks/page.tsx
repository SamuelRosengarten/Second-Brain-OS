"use client";
import { useSearchParams } from "next/navigation";
import { ListTodo } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { localToday, useApi } from "@/components/client";
import { NewTask, TaskRow } from "@/components/task-list";
import { EmptyState, ErrorBox, ListSkeleton, PageHeader, RowList, Section, Select } from "@/components/ui";
import type { Project, Task } from "@/lib/projects";

function groupTasks(tasks: Task[], today: string) {
  const g = { overdue: [] as Task[], today: [] as Task[], upcoming: [] as Task[], none: [] as Task[], done: [] as Task[] };
  for (const t of tasks) {
    if (t.status === "done") g.done.push(t);
    else if (!t.due_date) g.none.push(t);
    else if (t.due_date < today) g.overdue.push(t);
    else if (t.due_date === today) g.today.push(t);
    else g.upcoming.push(t);
  }
  return g;
}

function Tasks() {
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") ?? "open");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState(sp.get("due") ?? "");
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (priority) qs.set("priority", priority);
  if (due) qs.set("due", due);
  const today = localToday();
  qs.set("today", today);
  const { data, error, loading, reload } = useApi<{ tasks: Task[] }>(`/api/tasks?${qs}`);
  const projects = useApi<{ projects: Project[] }>("/api/projects");
  const names = new Map((projects.data?.projects ?? []).map((p) => [p.id, p.name]));
  const activeProjects = (projects.data?.projects ?? []).filter((p) => p.status !== "archived");
  const groups = useMemo(() => groupTasks(data?.tasks ?? [], today), [data, today]);
  const sections: { key: keyof typeof groups; title: string }[] = [
    { key: "overdue", title: "Overdue" },
    { key: "today", title: "Today" },
    { key: "upcoming", title: "Upcoming" },
    { key: "none", title: "No due date" },
    { key: "done", title: "Completed" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Tasks" subtitle="Simple and personal. Tasks can come from the inbox or be added here." />
      <div className="mb-6 rounded-lg border border-line bg-surface p-3">
        <NewTask autoFocus={sp.get("new") === "1"} projects={activeProjects} onCreated={() => void reload()} />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
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
      {loading && !data && <ListSkeleton />}
      {data && data.tasks.length === 0 && (
        <EmptyState icon={ListTodo} title="No tasks here">{status === "open" && !priority && !due ? "Add your first task above, or turn an inbox suggestion into one." : "No tasks match these filters."}</EmptyState>
      )}
      <div className="space-y-6">
        {sections.map(({ key, title }) =>
          groups[key].length === 0 ? null : (
            <Section key={key} title={`${title} · ${groups[key].length}`}>
              <RowList>
                {groups[key].map((t) => (
                  <TaskRow key={t.id} task={t} projectName={t.project_id ? names.get(t.project_id) : undefined} projects={activeProjects} onChange={() => void reload()} />
                ))}
              </RowList>
            </Section>
          ),
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <Tasks />
    </Suspense>
  );
}
