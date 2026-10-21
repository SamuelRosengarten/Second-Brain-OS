"use client";
import Link from "next/link";
import { ArrowRight, Check, FileText, X } from "lucide-react";
import { useState } from "react";
import { dowDay, shortDow } from "@/lib/dates";
import { wouldCycle } from "@/lib/workflow-logic";
import { AiPanel, ProjectSquare } from "../blocks";
import type { Model } from "../workflow/model";
import { fmtHours } from "./plan-utils";

const h3 = "m-0 text-[12.5px] font-semibold text-muted";
const row = "flex min-h-9 items-center gap-2.5 rounded-[9px] bg-surface2 px-2.5 py-1.5 text-[13px] text-fg hover:bg-hover";

export interface PlanInspectorProps {
  model: Model;
  id: string | null;
  today: string;
  /** "graph" lists every connection with its kind (BLOCKS, NOTE, TAG…); "week" groups them. */
  variant: "week" | "graph";
  onJump: (id: string) => void;
  onToggleDone: (id: string) => void;
  onEdit: (id: string) => void;
  onMove: (id: string) => void;
  onAddDep: (taskId: string, dependsOn: string) => void;
  onRemoveDep: (taskId: string, dependsOn: string) => void;
  onAccept: (suggestionId: string) => void;
  onDismiss: (suggestionId: string) => void;
  onShowOnWeek?: (id: string) => void;
  onShowInGraph?: (id: string) => void;
}

export function PlanInspector(p: PlanInspectorProps) {
  const m = p.model;
  const e = p.id ? m.entities.get(p.id) : undefined;
  const [pick, setPick] = useState("");
  if (!p.id || !e) {
    return (
      <aside aria-label="Details" className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-[18px]">
        <span className="font-mono text-[11px] tracking-[0.06em] text-faint">NOTHING SELECTED</span>
        <p className="m-0 text-[13.5px] text-muted">Select a task to see what it blocks, what it waits for, the notes behind it and any links your local AI suggests.</p>
      </aside>
    );
  }
  const id = p.id;
  const task = e.kind === "task" ? m.graph.byId.get(id) : undefined;
  const proj = task ? m.projects.find((x) => x.id === (task.project_id ?? "")) : undefined;
  const linksOf = (x: string) => m.links.filter((l) => l.kind === "link" && (l.a === x || l.b === x)).map((l) => (l.a === x ? l.b : l.a));

  // notes behind a task: the capture it came from, and the note that capture became
  const noteIds = new Set<string>();
  if (task) for (const c of linksOf(id)) if (m.entities.get(c)?.kind === "capture") for (const n of linksOf(c)) if (m.entities.get(n)?.kind === "note") noteIds.add(n);
  const blocks = task ? m.graph.depOut.get(id) ?? [] : [];
  const waits = task ? m.graph.depIn.get(id) ?? [] : [];
  const sugg = m.suggestions.filter((s) => s.a === id || s.b === id);
  const addable = task
    ? m.tasks.filter((x) => x.id !== id && x.status !== "done" && !waits.includes(x.id) && !wouldCycle(m.deps, x.id, id)).map((x) => ({ id: x.id, title: x.title }))
    : [];
  const title = (x: string) => m.entities.get(x)?.title ?? "";

  const due = task?.due_date ?? null;
  const dueChip = !task ? null : task.status === "done" ? { text: "Done", cls: "bg-ok/15 text-ok" } : !due ? { text: "No date", cls: "bg-surface2 text-muted" } : due < p.today ? { text: `Overdue · ${shortDow(due)}`, cls: "bg-danger/15 text-danger" } : due === p.today ? { text: "Due today", cls: "bg-warn/15 text-warn" } : { text: dowDay(due), cls: "bg-surface2 text-muted" };

  return (
    <aside aria-labelledby="ins-h" className="flex flex-col gap-[18px] rounded-[14px] border border-line bg-surface p-[18px]">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[0.06em] text-faint uppercase">{p.variant === "graph" ? `${e.kind}${proj ? ` · ${proj.name}` : ""}` : task ? "Selected task" : e.kind}</span>
        <h2 id="ins-h" className="m-0 text-[17px] leading-[1.3] font-semibold tracking-[-0.01em]">{e.title}</h2>
        {task && (
          <div className="flex flex-wrap gap-1.5">
            {proj && <span className="flex h-6 items-center gap-1.5 rounded-md bg-surface2 px-2 text-xs text-muted"><ProjectSquare color={proj.color} size={7} />{proj.name}</span>}
            {dueChip && <span className={`flex h-6 items-center rounded-md px-2 font-mono text-[11.5px] ${dueChip.cls}`}>{dueChip.text}</span>}
            {task.estimate_min ? <span className="flex h-6 items-center rounded-md bg-surface2 px-2 font-mono text-[11.5px] text-muted">{fmtHours(task.estimate_min)}</span> : null}
          </div>
        )}
      </div>

      {task ? (
        <>
          {p.variant === "week" ? (
            <>
              <div className="flex flex-col gap-2">
                <h3 className={h3}>Blocks</h3>
                {blocks.length === 0 ? <p className="m-0 text-[13px] text-faint">Nothing is waiting on this.</p> : blocks.map((b) => (
                  <button key={b} type="button" onClick={() => p.onJump(b)} className={`${row} text-left`}><ArrowRight size={14} aria-hidden strokeWidth={2} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{title(b)}</span><span className="font-mono text-[11px] text-faint">{m.graph.byId.get(b)?.due_date ? shortDow(m.graph.byId.get(b)!.due_date!) : ""}</span></button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <h3 className={h3}>Depends on</h3>
                {waits.length === 0 && <p className="m-0 text-[13px] text-faint">Nothing, ready to start.</p>}
                {waits.map((w) => (
                  <span key={w} className={row}>
                    <button type="button" onClick={() => p.onJump(w)} className="min-w-0 flex-1 truncate text-left">{title(w)}</button>
                    <button type="button" aria-label={`Remove dependency on ${title(w)}`} onClick={() => p.onRemoveDep(id, w)} className="grid size-8 shrink-0 place-items-center rounded-md text-faint hover:text-danger"><X size={14} aria-hidden /></button>
                  </span>
                ))}
                {addable.length > 0 && (
                  <div className="flex gap-2">
                    <label htmlFor="add-dep" className="sr-only">Add a dependency</label>
                    <select id="add-dep" value={pick} onChange={(ev) => setPick(ev.target.value)} className="h-10 min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2 text-[13px] text-fg">
                      <option value="">Must wait for…</option>
                      {addable.map((a) => <option key={a.id} value={a.id}>{a.title.length > 50 ? `${a.title.slice(0, 49)}…` : a.title}</option>)}
                    </select>
                    <button type="button" disabled={!pick} onClick={() => { p.onAddDep(id, pick); setPick(""); }} className="h-10 rounded-[9px] border border-line px-3 text-[13px] font-medium hover:bg-hover disabled:opacity-50">Add</button>
                  </div>
                )}
              </div>
              {noteIds.size > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className={h3}>Linked notes</h3>
                  {[...noteIds].map((n) => <Link key={n} href={`/knowledge/${n}`} className={row}><FileText size={14} aria-hidden strokeWidth={1.8} className="shrink-0 text-muted" />{title(n)}</Link>)}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <h3 className={`${h3} mb-1`}>Connections · {new Set([...blocks, ...waits, ...[...(m.neighbours.get(id) ?? [])].filter((x) => m.entities.get(x)?.kind !== "project")]).size}</h3>
              {[...blocks].map((b) => <button key={`b${b}`} type="button" onClick={() => p.onJump(b)} className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 text-left text-[13px] hover:bg-hover"><span className="w-[52px] font-mono text-[10.5px] text-faint">BLOCKS</span>{title(b)}</button>)}
              {[...waits].map((w) => <button key={`w${w}`} type="button" onClick={() => p.onJump(w)} className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 text-left text-[13px] hover:bg-hover"><span className="w-[52px] font-mono text-[10.5px] text-faint">AFTER</span>{title(w)}</button>)}
              {[...(m.neighbours.get(id) ?? [])].filter((x) => !blocks.includes(x) && !waits.includes(x) && m.entities.get(x)?.kind !== "project").map((x) => (
                <button key={x} type="button" onClick={() => p.onJump(x)} className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 text-left text-[13px] hover:bg-hover"><span className="w-[52px] font-mono text-[10.5px] text-faint uppercase">{m.entities.get(x)?.kind}</span>{title(x)}</button>
              ))}
            </div>
          )}

          {sugg.length > 0 && (
            <AiPanel as="div" className="flex flex-col gap-2.5 p-3.5">
              <h3 className="m-0 text-[13px] font-semibold">Suggested links <span className="float-right font-mono text-[11px] text-accent">{sugg.length} from your local model</span></h3>
              {sugg.map((s) => (
                <div key={s.id} className="flex flex-col gap-2 rounded-[9px] bg-surface p-3">
                  <p className="m-0 text-[13px] leading-[1.45]">{s.b === id ? <>Do <strong className="font-semibold">{title(s.a)}</strong> first.</> : <><strong className="font-semibold">{title(s.b)}</strong> should wait for this one.</>}</p>
                  <p className="m-0 text-xs leading-[1.45] text-muted">{s.why}</p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => p.onAccept(s.id)} aria-label={`Accept: ${title(s.a)} before ${title(s.b)}`} className="flex h-9 items-center gap-1.5 rounded-[7px] bg-accent px-3 text-xs font-semibold text-accent-fg"><Check size={13} aria-hidden strokeWidth={2.5} />Accept</button>
                    <button type="button" onClick={() => p.onDismiss(s.id)} aria-label={`Dismiss: ${title(s.a)} before ${title(s.b)}`} className="h-9 rounded-[7px] border border-line px-3 text-xs text-muted hover:bg-hover">Dismiss</button>
                  </div>
                </div>
              ))}
            </AiPanel>
          )}

          <div className="flex flex-wrap gap-2">
            {p.variant === "graph" && p.onShowOnWeek ? (
              <button type="button" onClick={() => p.onShowOnWeek!(id)} className="flex h-10 flex-1 items-center justify-center rounded-[9px] bg-primary px-3 text-[13px] font-semibold text-primary-fg hover:bg-primary-hover">Show on week</button>
            ) : (
              <button type="button" onClick={() => p.onToggleDone(id)} className="flex h-10 flex-1 items-center justify-center rounded-[9px] bg-primary px-3 text-[13px] font-semibold text-primary-fg hover:bg-primary-hover">{task.status === "done" ? "Mark as not done" : "Mark done"}</button>
            )}
            {p.variant === "graph" && <button type="button" onClick={() => p.onToggleDone(id)} className="h-10 flex-1 rounded-[9px] border border-line px-3 text-[13px] text-muted hover:bg-hover">{task.status === "done" ? "Not done" : "Mark done"}</button>}
            <button type="button" onClick={() => p.onMove(id)} className="h-10 rounded-[9px] border border-line px-3 text-[13px] text-muted hover:bg-hover">Move…</button>
            <button type="button" onClick={() => p.onEdit(id)} className="h-10 rounded-[9px] border border-line px-3 text-[13px] text-muted hover:bg-hover">Edit</button>
          </div>
          {p.variant === "week" && p.onShowInGraph && <button type="button" onClick={() => p.onShowInGraph!(id)} className="self-start text-[13px] text-muted hover:text-fg">Show in graph →</button>}
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <h3 className={`${h3} mb-1`}>Connections · {(m.neighbours.get(id)?.size ?? 0)}</h3>
          {[...(m.neighbours.get(id) ?? [])].map((x) => (
            <button key={x} type="button" onClick={() => p.onJump(x)} className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 text-left text-[13px] hover:bg-hover"><span className="w-[52px] font-mono text-[10.5px] text-faint uppercase">{m.entities.get(x)?.kind}</span>{title(x)}</button>
          ))}
          {(m.neighbours.get(id)?.size ?? 0) === 0 && <p className="m-0 text-[13px] text-faint">Not connected to anything yet.</p>}
          <Link href={e.kind === "note" ? `/knowledge/${id}` : e.kind === "project" ? `/projects/${id}` : e.kind === "capture" ? `/inbox/${id}` : "/knowledge"} className="mt-2 flex h-10 items-center justify-center rounded-[9px] bg-primary text-[13px] font-semibold text-primary-fg hover:bg-primary-hover">Open {e.kind}</Link>
        </div>
      )}
    </aside>
  );
}
