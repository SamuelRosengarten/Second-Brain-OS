"use client";
import Link from "next/link";
import { useState } from "react";
import { addDays, fullDow, shortDow } from "@/lib/dates";
import type { Model } from "../workflow/model";
import { cx } from "../ui";
import { ProjectSquare } from "../blocks";
import { fmtHours, isHeavy, loadPct, shortTitle } from "./plan-utils";

export interface WeekProps {
  model: Model;
  start: string;
  today: string;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Dropping a card on a day (or choosing a day) reschedules it. */
  onMoveTo: (id: string, date: string) => void;
}

/** Overdue tasks, each with one-click fixes. */
export function OverdueBanners({ model: m, today, onToday, onPick, onSelect }: { model: Model; today: string; onToday: (id: string) => void; onPick: (id: string) => void; onSelect: (id: string) => void }) {
  const late = m.tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date < today && m.visibleProjects.some((p) => p.id === (t.project_id ?? "")));
  if (late.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {late.slice(0, 3).map((t) => (
        <section key={t.id} aria-label="Overdue" className="flex flex-wrap items-center gap-3 rounded-[10px] border py-2.5 pr-3 pl-3.5" style={{ background: "color-mix(in srgb, var(--danger) 8%, transparent)", borderColor: "color-mix(in srgb, var(--danger) 28%, transparent)" }}>
          <span className="font-mono text-[11.5px] tracking-[0.04em] text-danger">OVERDUE · {late.length}</span>
          <button type="button" onClick={() => onSelect(t.id)} className="min-w-48 flex-1 text-left text-[13.5px] hover:underline">{t.title} <span className="text-[12.5px] text-faint">· was due {shortDow(t.due_date!)}</span></button>
          <button type="button" onClick={() => onToday(t.id)} className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-fg hover:bg-primary-hover">Move to today</button>
          <button type="button" onClick={() => onPick(t.id)} className="h-9 rounded-lg border border-line px-3 text-[12.5px] text-muted hover:bg-hover">Pick a day</button>
        </section>
      ))}
      {late.length > 3 && <Link href="/tasks?due=overdue" className="text-[12.5px] text-muted hover:text-fg">+{late.length - 3} more overdue →</Link>}
    </div>
  );
}

/** The week as seven day columns: cards for tasks, the hours planned, and a load bar. */
export function WeekGrid({ model: m, start, today, selected, onSelect, onMoveTo }: WeekProps) {
  const [over, setOver] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const visible = new Set(m.visibleProjects.map((p) => p.id));
  const proj = new Map(m.projects.map((p) => [p.id, p]));
  const suggested = new Set(m.suggestions.flatMap((s) => [s.a, s.b]));

  return (
    <div className="overflow-x-auto pb-1">
      <div role="list" aria-label="Days of the week" tabIndex={0} className="grid min-w-[770px] grid-cols-7 gap-2" style={{ gridTemplateColumns: "repeat(7, minmax(104px, 1fr))" }}>
        {days.map((d) => {
          const tasks = m.tasks.filter((t) => t.due_date === d && visible.has(t.project_id ?? ""));
          const minutes = tasks.reduce((n, t) => n + (t.estimate_min ?? 0), 0);
          const isToday = d === today;
          return (
            <section
              key={d}
              role="listitem"
              aria-label={`${fullDow(d)} ${Number(d.slice(8))}, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}, ${fmtHours(minutes)} planned`}
              onDragOver={(e) => { e.preventDefault(); setOver(d); }}
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) onMoveTo(id, d); }}
              className="flex min-h-[540px] flex-col gap-2 rounded-xl border p-2"
              style={{ background: isToday ? "color-mix(in srgb, var(--warn) 5%, transparent)" : "transparent", borderColor: over === d ? "var(--accent)" : isToday ? "color-mix(in srgb, var(--warn) 35%, transparent)" : "var(--border)" }}
            >
              <div className="flex flex-col gap-1.5 px-0.5 pt-0.5 pb-1">
                <div className="flex items-baseline gap-1.5" style={{ color: isToday ? "var(--warn)" : "var(--muted)" }}>
                  <span className="font-mono text-[11px] tracking-[0.06em] uppercase">{shortDow(d)}</span>
                  <span className="text-[15px] font-semibold">{Number(d.slice(8))}</span>
                  <span className="ml-auto font-mono text-[11px] text-faint">{fmtHours(minutes)}</span>
                </div>
                <div aria-hidden className="h-1 overflow-hidden rounded-sm bg-line"><div className="h-1 rounded-sm" style={{ width: `${loadPct(minutes)}%`, background: isHeavy(minutes) ? "var(--warn)" : "var(--border-strong)" }} /></div>
              </div>
              {tasks.map((t) => {
                const done = t.status === "done";
                const p = proj.get(t.project_id ?? "");
                const after = (m.graph.depIn.get(t.id) ?? []).map((x) => m.graph.byId.get(x)).find((x) => x && x.status !== "done");
                const sel = selected === t.id;
                return (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; }}
                    className="flex flex-col gap-1.5 rounded-[9px] bg-surface"
                    style={{ border: sel ? "1.5px solid var(--text)" : "1px solid var(--border)", opacity: m.critOn && !m.crit.set.has(t.id) ? 0.45 : 1 }}
                  >
                    <button type="button" onClick={() => onSelect(t.id)} aria-pressed={sel} className="flex flex-col gap-1.5 px-2.5 py-[9px] text-left">
                      <span className={cx("text-[12.5px] leading-[1.35]", done ? "text-faint line-through" : "text-fg")}>{t.title}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-faint">
                        <ProjectSquare color={p?.color ?? "var(--faint)"} size={6} />
                        <span className="min-w-0 flex-1 truncate">{p?.name ?? "No project"}</span>
                        {t.estimate_min ? <span className="font-mono">{fmtHours(t.estimate_min)}</span> : null}
                      </span>
                      {after && <span className="max-w-full self-start truncate rounded-[5px] bg-hover px-1.5 py-0.5 font-mono text-[10.5px] text-muted">after: {shortTitle(after.title, 22)}</span>}
                      {suggested.has(t.id) && <span className="max-w-full self-start truncate rounded-[5px] border border-dashed border-ai-line px-1.5 py-0.5 font-mono text-[10.5px] text-accent">AI: link suggested</span>}
                    </button>
                  </article>
                );
              })}
              {tasks.length === 0 && <div className="rounded-[9px] border border-dashed border-line2 p-2.5 text-center text-xs text-faint">Free. Drop a task here.</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
