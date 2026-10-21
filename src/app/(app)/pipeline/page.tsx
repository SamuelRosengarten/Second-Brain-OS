"use client";
import { useEffect, useMemo, useState } from "react";
import { Waypoints } from "lucide-react";
import { localToday, useApi } from "@/components/client";
import { Legend, PipelineHorizon, PipelineSummary, PipelineTimeline, RANGES } from "@/components/pipeline";
import { TaskEditDialog } from "@/components/task-list";
import { EmptyState, ErrorBox, ListSkeleton, PageHeader, Select, Tabs } from "@/components/ui";
import type { Project, Task } from "@/lib/projects";

type View = "timeline" | "horizon";

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode or blocked storage: the choice just is not remembered
  }
}

export default function PipelinePage() {
  const today = localToday();
  const { data, error, loading, reload } = useApi<{ projects: Project[]; tasks: Task[] }>(`/api/pipeline?today=${today}`);
  const [view, setView] = useState<View>("timeline");
  const [range, setRange] = useState(42);
  const [showDone, setShowDone] = useState(true);
  const [project, setProject] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);

  // Remembered per device; phones start on the Horizon view because a wide timeline is awkward at 390px.
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)").matches;
    setView(load<View>("sbos-pipeline-view", ["timeline", "horizon"], phone ? "horizon" : "timeline"));
    setRange(Number(load("sbos-pipeline-range", ["14", "42", "90"], "42")));
  }, []);

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) => !project || t.project_id === project), [data, project]);
  const shownProjects = useMemo(() => projects.filter((p) => !project || p.id === project), [projects, project]);

  return (
    <div className="mx-auto max-w-[110rem] space-y-5">
      <PageHeader title="Pipeline" subtitle="Every project and task on one board, laid out by due date." />
      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !data && <ListSkeleton />}
      {data && (
        <>
          <PipelineSummary projects={shownProjects} tasks={tasks} today={today} />
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              label="Pipeline view"
              value={view}
              onChange={(v) => { setView(v); save("sbos-pipeline-view", v); }}
              tabs={[{ id: "timeline", label: "Timeline" }, { id: "horizon", label: "By due date" }]}
            />
            {view === "timeline" && (
              <Select aria-label="Time range" value={String(range)} onChange={(e) => { setRange(Number(e.target.value)); save("sbos-pipeline-range", e.target.value); }} className="w-36">
                {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
              </Select>
            )}
            <Select aria-label="Project filter" value={project} onChange={(e) => setProject(e.target.value)} className="w-52">
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-[var(--accent)] sm:size-4" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              Show finished
            </label>
          </div>
          <Legend />
          {projects.length === 0 && tasks.length === 0 ? (
            <EmptyState icon={Waypoints} title="Nothing to show yet">Create a project and add tasks with due dates. They appear here as soon as they exist.</EmptyState>
          ) : view === "timeline" ? (
            <PipelineTimeline projects={shownProjects} tasks={tasks} today={today} rangeDays={range} showDone={showDone} onOpen={(t) => setEditing(t as Task)} />
          ) : (
            <PipelineHorizon projects={shownProjects} tasks={tasks} today={today} showDone={showDone} onOpen={(t) => setEditing(t as Task)} />
          )}
        </>
      )}
      {editing && (
        <TaskEditDialog
          key={editing.id}
          task={editing}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}
