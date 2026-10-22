"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, Sparkles, TrendingUp } from "lucide-react";
import { Suspense, useMemo, useRef, useState } from "react";
import { segmentClass, Segmented, useProjects } from "@/components/blocks";
import { api, localToday, useApi } from "@/components/client";
import { DayList, SuggestionCard } from "@/components/plan/day-list";
import { PlanInspector } from "@/components/plan/inspector";
import { DAY_LIMIT_MIN, fmtHours, shortTitle, suggestRebalance, weekLabel, type RebalanceMove } from "@/components/plan/plan-utils";
import { OverdueBanners, WeekGrid } from "@/components/plan/week-view";
import { TaskEditDialog } from "@/components/task-list";
import { cx, Dialog, EmptyState, ErrorBox, ListSkeleton, useToast } from "@/components/ui";
import { MoveDialog } from "@/components/workflow/agenda";
import { GraphCanvas } from "@/components/workflow/graph";
import { useNarrow } from "@/components/workflow/hooks";
import { buildModel, fmtDay, focusSets, hopSets } from "@/components/workflow/model";
import { TimelineCanvas } from "@/components/workflow/timeline";
import { addDays, shortDow, weekStart } from "@/lib/dates";
import { RANGE_DAYS, type Range } from "@/lib/workflow-logic";
import type { Task } from "@/lib/projects";
import type { WorkflowData } from "@/lib/workflow";

type View = "week" | "timeline" | "graph";
const VIEWS: { id: View; label: string }[] = [{ id: "week", label: "Week" }, { id: "timeline", label: "Timeline" }, { id: "graph", label: "Graph" }];
const RANGES: { id: Range; label: string }[] = [{ id: "week", label: "Week" }, { id: "2w", label: "2 weeks" }, { id: "month", label: "Month" }];
const chip = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px]";

function PlanPage() {
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const today = localToday();
  const narrow = useNarrow(1024);
  const { projects } = useProjects();
  const { data, error, loading, reload } = useApi<WorkflowData>(`/api/workflow?today=${today}`);

  const asked = sp.get("view");
  // Timeline and Graph are desktop-only; on a phone the Plan page is the week.
  const view: View = asked === "graph" && !narrow ? "graph" : asked === "timeline" && !narrow ? "timeline" : "week";
  const [offset, setOffset] = useState(0);
  const [projectFilter, setProjectFilter] = useState("");
  const [range, setRange] = useState<Range>("2w");
  const [crit, setCrit] = useState(false);
  const [show, setShow] = useState({ task: true, note: true, tag: true, capture: false, sugg: true });
  const [group, setGroup] = useState(false);
  const [depth, setDepth] = useState<"1" | "2" | "all">("all");
  const [skippedMoves, setSkippedMoves] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const [dueOv, setDueOv] = useState<Record<string, string | null>>({});
  const [doneOv, setDoneOv] = useState<Record<string, boolean>>({});
  const [dayPick, setDayPick] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [sheet, setSheet] = useState(false);
  const [finding, setFinding] = useState(false);
  const origin = useRef<Record<string, string | null>>({});

  // Filtering to one project hides every other lane, including the pseudo "No project" one (id "").
  const hidden = useMemo(() => new Set(projectFilter ? [...(data?.projects ?? []).map((p) => p.id).filter((id) => id !== projectFilter), ""] : []), [data, projectFilter]);
  const model = useMemo(
    () => (data ? buildModel({ data, today, dueOv, doneOv, hidden, showLow: true, crit, showSugg: show.sugg, show }) : null),
    [data, today, dueOv, doneOv, hidden, crit, show],
  );
  const focusId = hov ?? sel;
  const sets = useMemo(() => (model ? (depth !== "all" && view === "graph" ? hopSets(model, focusId, depth === "1" ? 1 : 2) : focusSets(model, focusId)) : null), [model, focusId, depth, view]);

  const start = addDays(weekStart(today), offset * 7);
  const rebalance = useMemo(() => {
    if (!model) return null;
    const visible = new Set(model.visibleProjects.map((p) => p.id));
    const dues = (id: string) => (model.graph.depOut.get(id) ?? []).map((x) => model.graph.byId.get(x)).filter((x) => x && x.status !== "done" && x.due_date).map((x) => x!.due_date!);
    return suggestRebalance(model.tasks.filter((t) => visible.has(t.project_id ?? "")), Array.from({ length: 7 }, (_, i) => addDays(start, i)), today, dues, (mv) => skippedMoves.has(`${mv.taskId}:${mv.to}`));
  }, [model, start, today, skippedMoves]);
  const day = dayPick && dayPick >= start && dayPick <= addDays(start, 6) ? dayPick : today >= start && today <= addDays(start, 6) ? today : start;

  const fail = (e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong", "danger");
  const clearOv = (id: string) => {
    setDueOv((o) => { const n = { ...o }; delete n[id]; return n; });
    setDoneOv((o) => { const n = { ...o }; delete n[id]; return n; });
  };
  async function patchTask(id: string, body: object) {
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body });
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      clearOv(id);
    }
  }
  function onDue(id: string, date: string | null, commit: boolean) {
    const t = model?.graph.byId.get(id);
    if (!t) return;
    if (!(id in origin.current)) origin.current[id] = t.due_date;
    setDueOv((o) => ({ ...o, [id]: date }));
    if (!commit) return;
    const from = origin.current[id];
    delete origin.current[id];
    if (from === date) { clearOv(id); return; }
    void patchTask(id, { due_date: date });
  }
  function toggleDone(id: string) {
    const t = model?.graph.byId.get(id);
    if (!t) return;
    const nowDone = t.status !== "done";
    setDoneOv((o) => ({ ...o, [id]: nowDone }));
    void patchTask(id, { status: nowDone ? "done" : "todo" });
  }
  function acceptMove(mv: RebalanceMove) {
    onDue(mv.taskId, mv.to, true);
    toast(`Moved ${shortTitle(mv.title, 36)} to ${shortDow(mv.to)}`, "ok", {
      label: "Undo",
      // patched directly: onDue would compare against the stale pre-move due date and skip the write
      onClick: () => { setDueOv((o) => ({ ...o, [mv.taskId]: mv.from })); void patchTask(mv.taskId, { due_date: mv.from }); },
    });
  }
  const dismissMove = (mv: RebalanceMove) => setSkippedMoves((s) => new Set(s).add(`${mv.taskId}:${mv.to}`));
  async function dep(kind: "add" | "remove", task: string, on: string) {
    try {
      if (kind === "add") await api(`/api/tasks/${task}/deps`, { body: { depends_on: on } });
      else await api(`/api/tasks/${task}/deps?on=${encodeURIComponent(on)}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      fail(e);
    }
  }
  async function resolve(id: string, action: "accept" | "dismiss") {
    const sg = model?.suggestions.find((x) => x.id === id);
    const name = (t: string) => shortTitle(model?.graph.byId.get(t)?.title ?? "", 28);
    try {
      await api(`/api/workflow/suggestions/${id}`, { body: { action } });
      if (action === "accept" && sg) toast(`Linked ${name(sg.a)} before ${name(sg.b)}`, "ok", { label: "Undo", onClick: () => void dep("remove", sg.b, sg.a) });
      else toast(action === "accept" ? "Link added" : "Suggestion dismissed", "ok");
      await reload();
    } catch (e) {
      fail(e);
      await reload();
    }
  }
  async function findLinks() {
    setFinding(true);
    try {
      const r = await api<{ added: number; considered: number }>("/api/workflow/suggest", { body: {} });
      toast(r.added ? `Found ${r.added} possible ${r.added === 1 ? "dependency" : "dependencies"} to review` : r.considered < 2 ? "You need at least two open tasks" : "No new dependencies found", "ok");
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setFinding(false);
    }
  }

  const setView = (v: View) => router.replace(v === "week" ? "/plan" : `/plan?view=${v}`);
  const select = (id: string | null) => { setSel(id); if (id && narrow) setSheet(true); };
  const jump = (id: string) => { setSel(id); setHov(null); };
  const showOnWeek = (id: string) => {
    const t = model?.graph.byId.get(id);
    if (t?.due_date) { setOffset(Math.round((new Date(`${weekStart(t.due_date)}T12:00:00`).getTime() - new Date(`${weekStart(today)}T12:00:00`).getTime()) / (7 * 86_400_000))); setDayPick(t.due_date); }
    setSel(id);
    setView("week");
  };
  const showInGraph = (id: string) => { setSel(id); setView("graph"); };

  const critText = model && model.critOn ? `${model.crit.path.length} tasks decide your finish date, ending ${fmtDay(model.graph.byId.get(model.crit.path[0])?.due_date ?? today)}` : "";
  const inspector = model && (
    <PlanInspector
      model={model}
      id={sel}
      today={today}
      variant={view === "graph" ? "graph" : "week"}
      onJump={jump}
      onToggleDone={toggleDone}
      onEdit={(id) => { const t = data?.tasks.find((x) => x.id === id); if (t) setEditing(t); }}
      onMove={(id) => setMoveFor(id)}
      onAddDep={(task, on) => void dep("add", task, on)}
      onRemoveDep={(task, on) => void dep("remove", task, on)}
      onAccept={(id) => void resolve(id, "accept")}
      onDismiss={(id) => void resolve(id, "dismiss")}
      onShowOnWeek={narrow ? undefined : showOnWeek}
      onShowInGraph={narrow ? undefined : showInGraph}
      keys={!narrow && (view === "graph" || !rebalance)}
      onClose={() => { setSel(null); setSheet(false); }}
    />
  );
  const counts = model ? {
    task: model.tasks.length,
    note: [...model.entities.values()].filter((e) => e.kind === "note").length,
    tag: [...model.entities.values()].filter((e) => e.kind === "tag").length,
    capture: [...model.entities.values()].filter((e) => e.kind === "capture").length,
  } : { task: 0, note: 0, tag: 0, capture: 0 };

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-4 lg:gap-5">
      <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Plan</h1>
        {narrow && view === "week" && (
          <div className="flex items-center">
            <button type="button" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)} className="grid size-9 place-items-center rounded-lg text-muted"><ChevronLeft size={16} aria-hidden strokeWidth={2} /></button>
            <span className="font-mono text-xs text-faint">{weekLabel(start)}</span>
            <button type="button" aria-label="Next week" onClick={() => setOffset((o) => o + 1)} className="grid size-9 place-items-center rounded-lg text-muted"><ChevronRight size={16} aria-hidden strokeWidth={2} /></button>
          </div>
        )}
        {!narrow && (
          <Segmented label="Plan views" className="ml-auto lg:ml-0">
            {VIEWS.map((v) => (
              <Link key={v.id} href={v.id === "week" ? "/plan" : `/plan?view=${v.id}`} replace aria-current={view === v.id ? "page" : undefined} className={segmentClass(view === v.id)}>{v.label}</Link>
            ))}
          </Segmented>
        )}
        {!narrow && view === "week" && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-hover"><ChevronLeft size={16} aria-hidden strokeWidth={2} /></button>
            <span className="font-mono text-[12.5px]">{weekLabel(start)}</span>
            <button type="button" aria-label="Next week" onClick={() => setOffset((o) => o + 1)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-hover"><ChevronRight size={16} aria-hidden strokeWidth={2} /></button>
            {offset !== 0 && <button type="button" onClick={() => setOffset(0)} className="ml-1 h-8 rounded-lg px-2.5 text-xs text-muted hover:bg-hover">This week</button>}
          </div>
        )}
        {!narrow && view === "week" && (
          <span className="flex items-center gap-[7px] text-xs text-faint"><span aria-hidden className="h-3 w-0.5 rounded-[1px] bg-muted" />{fmtHours(DAY_LIMIT_MIN)} daily limit</span>
        )}
        {!narrow && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {view === "graph" ? (
              <div role="group" aria-label="Show in graph" className="flex flex-wrap gap-1.5">
                {([["task", "Tasks"], ["note", "Notes"], ["tag", "Tags"], ["capture", "Captures"]] as const).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} className={chip} style={{ borderColor: show[k] ? "var(--border-strong)" : "var(--border)", background: show[k] ? "var(--elevated)" : "transparent", color: show[k] ? "var(--text)" : "var(--muted)", borderStyle: show[k] ? "solid" : "dashed" }}>
                    {label} <span className="font-mono text-[11px] text-faint">{counts[k]}</span>
                  </button>
                ))}
                <button type="button" aria-pressed={show.sugg} onClick={() => setShow((s) => ({ ...s, sugg: !s.sugg }))} className={chip} style={{ borderColor: show.sugg ? "var(--ai-line)" : "var(--border)", background: show.sugg ? "var(--ai-bg)" : "transparent", color: show.sugg ? "var(--accent)" : "var(--muted)" }}>AI suggestions</button>
              </div>
            ) : (
              <>
                {data && (
                  <>
                    <label className="sr-only" htmlFor="plan-project">Project</label>
                    <select id="plan-project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-[34px] rounded-[9px] border border-line bg-transparent px-3 text-[12.5px] text-muted">
                      <option value="">All projects</option>
                      {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </>
                )}
                {view === "timeline" && (
                  <>
                    <button type="button" aria-pressed={crit} onClick={() => setCrit((v) => !v)} className="flex h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-[12.5px]" style={{ borderColor: crit ? "var(--text)" : "var(--border)", background: crit ? "var(--hover)" : "transparent", color: crit ? "var(--text)" : "var(--muted)" }}><TrendingUp size={14} aria-hidden />Critical path</button>
                    <div role="group" aria-label="Date range" className="flex rounded-[9px] border border-line bg-surface p-[3px]">
                      {RANGES.map((r) => <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)} className={cx("h-7 rounded-md px-2.5 text-xs", range === r.id ? "bg-surface2 font-medium text-fg" : "text-muted")}>{r.label}</button>)}
                    </div>
                  </>
                )}
                <button type="button" onClick={() => void findLinks()} disabled={finding} aria-busy={finding} className="flex h-[34px] items-center gap-2 rounded-[9px] border border-ai-line bg-ai-bg px-3 text-[12.5px] font-medium text-accent disabled:opacity-60">
                  <Sparkles size={14} aria-hidden strokeWidth={1.8} />{finding ? "Thinking…" : "Suggest dependencies"}
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !data && <ListSkeleton />}

      {model && data && (model.projects.length === 0 && model.tasks.length === 0 ? (
        <EmptyState title="Nothing to plan yet">Create a project and add tasks with due dates. They appear here as soon as they exist.</EmptyState>
      ) : (
        <>
          {view === "week" && narrow && (
            <div className="flex flex-col gap-4">
              <SuggestionCard model={model} onAccept={(id) => void resolve(id, "accept")} onDismiss={(id) => void resolve(id, "dismiss")} />
              <DayList model={model} start={start} today={today} day={day} onDay={setDayPick} onOpen={(id) => { setSel(id); setSheet(true); }} onToggleDone={toggleDone} />
              <button type="button" onClick={() => void findLinks()} disabled={finding} aria-busy={finding} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-ai-line bg-ai-bg text-sm font-medium text-accent disabled:opacity-60"><Sparkles size={15} aria-hidden strokeWidth={1.8} />{finding ? "Thinking…" : "Suggest dependencies"}</button>
            </div>
          )}
          {view === "week" && !narrow && (
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
                <OverdueBanners model={model} today={today} onToday={(id) => onDue(id, today, true)} onPick={(id) => setMoveFor(id)} onSelect={(id) => setSel(id)} />
                <WeekGrid model={model} start={start} today={today} selected={sel} onSelect={(id) => select(id)} onMoveTo={(id, d) => onDue(id, d, true)} rebalance={rebalance} onAcceptMove={acceptMove} onDismissMove={dismissMove} />
              </div>
              <div className="min-w-0 max-w-[360px] flex-[1_1_300px] lg:sticky lg:top-8">{inspector}</div>
            </div>
          )}
          {view === "timeline" && !narrow && (
            <div className="flex flex-col gap-5">
              <section aria-label="Timeline" className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface">
                {critText && <p className="m-0 border-b border-line px-4 py-2.5 text-[13px]">{critText}</p>}
                <TimelineCanvas model={model} days={RANGE_DAYS[range]} focus={focusId} sets={sets} selected={sel} onSelect={select} onHover={setHov} onToggleDone={toggleDone} onDue={onDue} />
                <p className="m-0 border-t border-line px-4 py-2.5 text-xs text-muted">Drag a chip to move its due date (or focus it and press ← →). The number under each date is how many tasks are due that day. Arrows point from the task to finish first to the one that waits.</p>
              </section>
              <div className="min-h-[15rem] max-w-[460px]">{inspector}</div>
            </div>
          )}
          {view === "graph" && (
            <div className="flex flex-wrap items-start gap-5">
              <div className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-[14px] border border-line" style={{ background: "var(--bg)" }}>
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                  <button type="button" aria-pressed={group} onClick={() => { setGroup((g) => !g); setResetKey((k) => k + 1); }} className="h-9 rounded-[9px] border px-3 text-[12.5px]" style={{ borderColor: group ? "var(--ai-line)" : "var(--border)", background: group ? "var(--ai-bg)" : "transparent", color: group ? "var(--accent)" : "var(--muted)" }}>Group by project</button>
                  <div role="group" aria-label="Focus depth" className="flex rounded-[9px] border border-line bg-surface p-0.5">
                    {([["1", "1 hop"], ["2", "2 hops"], ["all", "Everything"]] as const).map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={depth === k} onClick={() => setDepth(k)} className={cx("h-8 rounded-[7px] px-2.5 text-xs", depth === k ? "bg-surface2 font-medium text-fg" : "text-muted hover:text-fg")}>{label}</button>
                    ))}
                  </div>
                  {sel && model.entities.get(sel) && <span className="flex h-9 items-center rounded-[9px] border border-line bg-surface px-2.5 text-xs text-muted">Centred on <strong className="ml-1 max-w-48 truncate font-semibold text-fg">{model.entities.get(sel)!.title}</strong></span>}
                  {narrow && (
                    <div role="group" aria-label="Show in graph" className="flex gap-1.5 overflow-x-auto">
                      {([["note", "Notes"], ["tag", "Tags"], ["capture", "Captures"]] as const).map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} className="h-9 shrink-0 rounded-full border px-3 text-[12.5px]" style={{ borderColor: show[k] ? "var(--border-strong)" : "var(--border)", background: show[k] ? "var(--elevated)" : "transparent", color: show[k] ? "var(--text)" : "var(--muted)" }}>{label}</button>
                      ))}
                    </div>
                  )}
                  <div className="ml-auto flex overflow-hidden rounded-[10px] border border-line">
                    <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))} className="grid size-9 place-items-center text-muted hover:text-fg"><Minus size={15} aria-hidden strokeWidth={2} /></button>
                    <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.2).toFixed(1)))} className="grid size-9 place-items-center border-l border-line text-muted hover:text-fg"><Plus size={15} aria-hidden strokeWidth={2} /></button>
                    <button type="button" aria-label="Fit to screen" onClick={() => { setZoom(1); setResetKey((k) => k + 1); }} className="grid size-9 place-items-center border-l border-line text-muted hover:text-fg"><Maximize2 size={14} aria-hidden strokeWidth={1.8} /></button>
                  </div>
                </div>
                <div className="overflow-auto" style={{ maxHeight: narrow ? undefined : 680 }}>
                  <div style={{ width: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                    <GraphCanvas model={model} focus={focusId} sets={sets} selected={sel} show={show} group={group} height={640} compact={narrow} resetKey={resetKey} onSelect={select} onHover={setHov} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">
                  <span className="flex items-center gap-1.5"><span className="size-[9px] rounded-full bg-muted" />Task</span>
                  <span className="flex items-center gap-1.5"><span className="size-[9px] rounded-sm border-[1.5px] border-muted" />Note</span>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="w-[18px] border-t-[1.6px] border-muted" />Must come first</span>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="w-[18px] border-t-[1.6px] border-dashed border-accent" />AI suggestion</span>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="w-[18px] border-t border-line2" />Linked</span>
                  <span className="ml-auto hidden lg:inline">Drag nodes · hover to trace</span>
                </div>
              </div>
              {!narrow && <div className="min-w-0 max-w-[340px] flex-[1_1_280px]">{inspector}</div>}
            </div>
          )}
        </>
      ))}

      {model && narrow && sheet && sel && (
        <Dialog open onClose={() => setSheet(false)} title="Details">
          <div className="flex flex-col gap-4 text-fg">{inspector}</div>
        </Dialog>
      )}
      {model && moveFor && (
        <MoveDialog
          open
          title={model.graph.byId.get(moveFor)?.title ?? ""}
          current={model.graph.byId.get(moveFor)?.due_date ?? null}
          today={today}
          onClose={() => setMoveFor(null)}
          onPick={(date) => { const id = moveFor; setMoveFor(null); if (id) onDue(id, date, true); }}
        />
      )}
      {model && (
        <p className="m-0 text-[13px] text-faint"><Link href="/tasks" className="text-muted hover:text-fg">All tasks, filters and the trash →</Link></p>
      )}
      {editing && <TaskEditDialog key={editing.id} task={editing} projects={projects.map((p) => ({ id: p.id, name: p.name }))} onClose={() => setEditing(null)} onSaved={() => void reload()} />}
    </div>
  );
}

export default function PlanRoute() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <PlanPage />
    </Suspense>
  );
}
