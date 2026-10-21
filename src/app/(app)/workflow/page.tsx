"use client";
import { Sparkles, TrendingUp, Waypoints, ListTree } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, localToday, useApi } from "@/components/client";
import { Agenda, MoveDialog } from "@/components/workflow/agenda";
import { GraphCanvas } from "@/components/workflow/graph";
import { loadPref, savePref, useNarrow } from "@/components/workflow/hooks";
import { Inspector } from "@/components/workflow/inspector";
import { buildModel, fmtDay, focusSets, tint } from "@/components/workflow/model";
import { SuggestionsPanel } from "@/components/workflow/suggestions";
import { TimelineCanvas } from "@/components/workflow/timeline";
import { TaskEditDialog } from "@/components/task-list";
import { Dialog, EmptyState, ErrorBox, ListSkeleton, useToast } from "@/components/ui";
import { RANGE_DAYS, type Range } from "@/lib/workflow-logic";
import type { WorkflowData } from "@/lib/workflow";
import type { Task } from "@/lib/projects";

type View = "timeline" | "graph";
const RANGES: { id: Range; label: string }[] = [{ id: "week", label: "Week" }, { id: "2w", label: "2 weeks" }, { id: "month", label: "Month" }];
const sectionBox = "overflow-hidden rounded-xl border border-[var(--wf-line)] bg-[var(--wf-panel)]";
const btn = "inline-flex items-center gap-2 rounded-lg border text-[13px] font-medium";

function Seg({ on, children, onClick, size = "md" }: { on: boolean; children: React.ReactNode; onClick: () => void; size?: "md" | "sm" }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${size === "md" ? "h-10 px-4 text-sm" : "h-10 px-3.5 text-[13px]"} inline-flex items-center gap-2 rounded-lg border font-medium`}
      style={{ borderColor: on ? "var(--wf-segline)" : "transparent", background: on ? "var(--wf-seg)" : "transparent", color: on ? "var(--wf-strong)" : "var(--wf-muted)" }}
    >
      {children}
    </button>
  );
}

export default function WorkflowPage() {
  const toast = useToast();
  const today = localToday();
  const narrow = useNarrow(768);
  const { data, error, loading, reload } = useApi<WorkflowData>(`/api/workflow?today=${today}`);

  const [view, setView] = useState<View>(() => loadPref<View>("sbos-workflow-view", ["timeline", "graph"], "timeline"));
  const [range, setRange] = useState<Range>(() => loadPref<Range>("sbos-workflow-range", ["week", "2w", "month"], "2w"));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [crit, setCrit] = useState(false);
  const [showLow, setShowLow] = useState(false);
  const [show, setShow] = useState({ note: true, tag: true, capture: true, sugg: true });
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const [dueOv, setDueOv] = useState<Record<string, string | null>>({});
  const [doneOv, setDoneOv] = useState<Record<string, boolean>>({});
  const [moves, setMoves] = useState<{ id: string; from: string | null }[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [finding, setFinding] = useState(false);
  const origin = useRef<Record<string, string | null>>({});

  const days = RANGE_DAYS[range];
  const model = useMemo(
    () => (data ? buildModel({ data, today, dueOv, doneOv, hidden, showLow, crit, showSugg: show.sugg, show }) : null),
    [data, today, dueOv, doneOv, hidden, showLow, crit, show],
  );
  const focus = hov ?? sel;
  const sets = useMemo(() => (model ? focusSets(model, focus) : null), [model, focus]);

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
    if (!(id in origin.current)) origin.current[id] = Object.prototype.hasOwnProperty.call(dueOv, id) ? (data?.tasks.find((x) => x.id === id)?.due_date ?? null) : t.due_date;
    setDueOv((o) => ({ ...o, [id]: date }));
    if (!commit) return;
    const from = origin.current[id];
    delete origin.current[id];
    if (from === date) { clearOv(id); return; }
    setMoves((m) => [...m, { id, from }]);
    void patchTask(id, { due_date: date });
  }
  function toggleDone(id: string) {
    const t = model?.graph.byId.get(id);
    if (!t) return;
    const nowDone = t.status !== "done";
    setDoneOv((o) => ({ ...o, [id]: nowDone }));
    void patchTask(id, { status: nowDone ? "done" : "todo" });
  }
  async function undoMoves() {
    const list = [...moves].reverse();
    setMoves([]);
    try {
      for (const mv of list) await api(`/api/tasks/${mv.id}`, { method: "PATCH", body: { due_date: mv.from } });
    } catch (e) {
      fail(e);
    }
    await reload();
  }
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
    try {
      await api(`/api/workflow/suggestions/${id}`, { body: { action } });
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
  const select = (id: string | null) => setSel(id);
  const jump = (id: string) => { setSel(id); setHov(null); };
  const setViewSaved = (v: View) => { setView(v); savePref("sbos-workflow-view", v); };
  const setRangeSaved = (r: Range) => { setRange(r); savePref("sbos-workflow-range", r); };

  const critText = model && model.critOn ? `${model.crit.path.length} tasks decide your finish date, ending ${fmtDay(model.graph.byId.get(model.crit.path[0])?.due_date ?? today)}` : "";
  const inspectorId = narrow ? sel : (hov ?? sel);
  const showInspectorDialog = narrow && !!sel;
  const inspector = model && (
    <Inspector
      model={model}
      id={inspectorId}
      pinned={!!sel && inspectorId === sel}
      preview={!!hov && hov !== sel}
      touch={narrow}
      onJump={jump}
      onToggleDone={toggleDone}
      onEdit={(id) => { const t = data?.tasks.find((x) => x.id === id); if (t) setEditing(t); }}
      onAddDep={(task, on) => void dep("add", task, on)}
      onRemoveDep={(task, on) => void dep("remove", task, on)}
    />
  );

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-4 sm:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[26px] leading-tight font-semibold">Workflow</h1>
          <p className="mt-1.5 text-sm text-[var(--wf-muted)]">Plan your week: what is due, what is ready, and what is waiting on something else.</p>
        </div>
        <div role="group" aria-label="View" className="flex gap-0.5 rounded-xl border border-[var(--wf-line)] bg-[var(--wf-panel)] p-[3px]">
          <Seg on={view === "timeline"} onClick={() => setViewSaved("timeline")}><ListTree size={16} aria-hidden />Timeline</Seg>
          <Seg on={view === "graph"} onClick={() => setViewSaved("graph")}><Waypoints size={16} aria-hidden />Graph</Seg>
        </div>
      </header>

      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !data && <ListSkeleton />}

      {model && data && (
        <>
          {model.projects.length === 0 && model.tasks.length === 0 ? (
            <EmptyState icon={Waypoints} title="Nothing to plan yet">Create a project and add tasks with due dates. They appear here as soon as they exist.</EmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div role="group" aria-label="Projects" className="flex flex-wrap items-center gap-2">
                  {model.projects.map((p) => {
                    const on = !hidden.has(p.id);
                    return (
                      <button
                        key={p.id || "none"}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                        className="inline-flex h-10 max-w-full items-center gap-2 rounded-full border px-3.5 text-[13px]"
                        style={{ borderColor: on ? tint(p.color, 40) : "var(--wf-btnline)", background: on ? tint(p.color, 10) : "transparent", color: on ? "var(--wf-strong)" : "var(--wf-muted)" }}
                      >
                        <span aria-hidden className="size-2 flex-none rounded-full" style={{ border: `1.5px solid ${p.color}`, background: on ? p.color : "transparent" }} />
                        <span className="min-w-0 truncate">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {critText && <span className="text-[13px] text-[var(--wf-text)]">{critText}</span>}
                  <button type="button" aria-pressed={crit} onClick={() => setCrit((v) => !v)} className={`${btn} h-10 px-3.5`} style={{ borderColor: crit ? "var(--wf-crit)" : "var(--wf-btnline)", background: crit ? "var(--wf-seg)" : "var(--wf-panel)", color: crit ? "var(--wf-strong)" : "var(--wf-soft)" }}>
                    <TrendingUp size={16} aria-hidden />Critical path
                  </button>
                  <button type="button" onClick={() => void findLinks()} disabled={finding} aria-busy={finding} className={`${btn} h-10 px-3.5 disabled:opacity-60`} style={{ borderColor: "var(--wf-btnline)", background: "var(--wf-panel)", color: "var(--wf-soft)" }}>
                    <Sparkles size={16} aria-hidden style={{ color: "var(--wf-acc)" }} />{finding ? "Thinking…" : "Find links with AI"}
                  </button>
                  {view === "timeline" && (
                    <div role="group" aria-label="Date range" className="flex gap-0.5 rounded-xl border border-[var(--wf-line)] bg-[var(--wf-panel)] p-[3px]">
                      {RANGES.map((r) => <Seg key={r.id} size="sm" on={range === r.id} onClick={() => setRangeSaved(r.id)}>{r.label}</Seg>)}
                    </div>
                  )}
                </div>
              </div>

              <SuggestionsPanel model={model} showLow={showLow} onToggleLow={() => setShowLow((v) => !v)} onAccept={(id) => void resolve(id, "accept")} onDismiss={(id) => void resolve(id, "dismiss")} />

              <section aria-label={view === "timeline" ? "Timeline" : "Graph"} className={sectionBox}>
                {view === "timeline" ? (
                  <>
                    {narrow ? (
                      <Agenda model={model} days={days} selected={sel} onSelect={select} onToggleDone={toggleDone} onMove={(id) => setMoveFor(id)} />
                    ) : (
                      <TimelineCanvas model={model} days={days} focus={focus} sets={sets} selected={sel} onSelect={select} onHover={setHov} onToggleDone={toggleDone} onDue={onDue} />
                    )}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--wf-line)] px-4 py-3 text-xs text-[var(--wf-muted)] sm:px-5">
                      {!narrow && <span>The number under each date is how many tasks are due that day</span>}
                      <span>{narrow ? "Tap the circle to mark done · tap the calendar to move a task" : "Drag a chip to move its due date (or focus it and press ← →)"}</span>
                      {!narrow && <span>Click the circle to mark done</span>}
                      <span className="flex items-center gap-2"><svg width="30" height="10" viewBox="0 0 30 10" aria-hidden><path d="M0 5H20" stroke="var(--wf-dep)" strokeWidth="1.5" fill="none" /><path d="M29 5L21 1V9Z" fill="var(--wf-dep)" /></svg>Finish first, then the one it points to</span>
                      <span className="flex items-center gap-2"><svg width="30" height="10" viewBox="0 0 30 10" aria-hidden><path d="M0 5H30" stroke="var(--wf-sug)" strokeWidth="1.6" strokeDasharray="3 4" fill="none" /></svg>Suggested by AI</span>
                      {moves.length > 0 && <button type="button" onClick={() => void undoMoves()} className="h-10 rounded-lg border border-[var(--wf-btnline)] bg-[var(--wf-btn)] px-3 text-xs text-[var(--wf-soft)] sm:ml-auto">Undo date changes</button>}
                    </div>
                  </>
                ) : (
                  <>
                    <GraphCanvas model={model} focus={focus} sets={sets} selected={sel} show={show} compact={narrow} resetKey={resetKey} onSelect={select} onHover={setHov} />
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--wf-line)] px-4 py-3 text-xs text-[var(--wf-muted)] sm:px-5">
                      <span className="text-[11px] font-medium tracking-[0.08em] uppercase">Show</span>
                      <div className="flex flex-wrap gap-2">
                        {([["note", "Notes"], ["tag", "Tags"], ["capture", "Captures"], ["sugg", "Suggested links"]] as const).map(([k, label]) => (
                          <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} className="h-10 rounded-full border px-3.5 text-xs" style={{ borderColor: show[k] ? "var(--wf-segline)" : "var(--wf-btnline)", background: show[k] ? "var(--wf-seg)" : "transparent", color: show[k] ? "var(--wf-strong)" : "var(--wf-muted)" }}>{label}</button>
                        ))}
                      </div>
                      <span>{narrow ? "Drag to move nodes · tap to inspect" : "Drag to move nodes"}</span>
                      {!narrow && <span>Hover to trace</span>}
                      <span className="flex items-center gap-2"><svg width="30" height="10" viewBox="0 0 30 10" aria-hidden><path d="M0 5H20" stroke="var(--wf-dep)" strokeWidth="1.5" fill="none" /><path d="M29 5L21 1V9Z" fill="var(--wf-dep)" /></svg>Depends on</span>
                      <span className="flex items-center gap-2"><svg width="30" height="10" viewBox="0 0 30 10" aria-hidden><path d="M0 5H30" stroke="var(--wf-link)" strokeWidth="1.3" strokeDasharray="4 5" fill="none" /></svg>Mentions</span>
                      <span className="flex items-center gap-2"><svg width="30" height="10" viewBox="0 0 30 10" aria-hidden><path d="M0 5H20" stroke="var(--wf-sug)" strokeWidth="1.6" strokeDasharray="3 4" fill="none" /><path d="M29 5L21 1V9Z" fill="var(--wf-sug)" /></svg>Suggested</span>
                      <span>Hollow dot: blocked</span>
                      <button type="button" onClick={() => setResetKey((k) => k + 1)} className="h-10 rounded-lg border border-[var(--wf-btnline)] bg-[var(--wf-btn)] px-3 text-xs text-[var(--wf-soft)] sm:ml-auto">Reset layout</button>
                    </div>
                  </>
                )}
              </section>

              {!narrow && <section aria-label="Details" className="flex min-h-[15rem] flex-wrap content-start gap-x-10 gap-y-5 rounded-xl border border-[var(--wf-line)] bg-[var(--wf-panel)] px-6 py-5">{inspector}</section>}
            </>
          )}
        </>
      )}

      {model && showInspectorDialog && (
        <Dialog open onClose={() => setSel(null)} title="Details">
          <div className="flex flex-col gap-5 [&>*]:flex-none">{inspector}</div>
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
      {editing && <TaskEditDialog key={editing.id} task={editing} projects={(data?.projects ?? []).map((p) => ({ id: p.id, name: p.name }))} onClose={() => setEditing(null)} onSaved={() => void reload()} />}
    </div>
  );
}
