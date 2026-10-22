"use client";
import { Sparkles } from "lucide-react";
import { addDays, fullDow, shortDow } from "@/lib/dates";
import { ProjectSquare, TaskCircle } from "../blocks";
import type { Model } from "../workflow/model";
import { cx } from "../ui";
import { LoadBar } from "./load-bar";
import { DAY_LIMIT_MIN, LIMIT_PCT, fmtHours, loadSegments, overBy } from "./plan-utils";

/**
 * Phone version of the week: a strip of seven days (with their load against the daily limit) and the chosen day's tasks below.
 * Tapping a task opens its details in a sheet; the circle completes it.
 */
export function DayList({ model: m, start, today, day, onDay, onOpen, onToggleDone }: {
  model: Model; start: string; today: string; day: string; onDay: (d: string) => void; onOpen: (id: string) => void; onToggleDone: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const visible = new Set(m.visibleProjects.map((p) => p.id));
  const proj = new Map(m.projects.map((p) => [p.id, p]));
  const minutesOf = (d: string) => m.tasks.filter((t) => t.due_date === d && visible.has(t.project_id ?? "")).reduce((n, t) => n + (t.estimate_min ?? 0), 0);
  const tasks = m.tasks.filter((t) => t.due_date === day && visible.has(t.project_id ?? ""));
  const minutes = tasks.reduce((n, t) => n + (t.estimate_min ?? 0), 0);
  const overMin = overBy(minutes);
  const segs = loadSegments(tasks.filter((t) => t.estimate_min).map((t) => ({ min: t.estimate_min!, color: proj.get(t.project_id ?? "")?.color ?? "var(--faint)", done: t.status === "done" })));

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Days" className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const sel = d === day;
          const isToday = d === today;
          const min = minutesOf(d);
          const over = min > DAY_LIMIT_MIN;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => onDay(d)}
              className="flex h-[66px] flex-col items-center justify-center gap-0.5 rounded-xl border p-0"
              style={{ borderColor: sel ? "var(--border-strong)" : "transparent", background: sel ? "var(--hover)" : "transparent", color: sel ? "var(--text)" : isToday ? "var(--warn)" : "var(--muted)" }}
            >
              <span className="font-mono text-[10.5px] tracking-[0.04em] uppercase">{shortDow(d)}</span>
              <span className="text-[17px] font-semibold">{Number(d.slice(8))}</span>
              <span className="sr-only">, {fmtHours(min)} planned{isToday ? ", today" : ""}{over ? ", over the daily limit" : ""}</span>
              <span aria-hidden className="relative block h-1 w-7 rounded-sm" style={{ background: `linear-gradient(90deg, var(--border) 0 ${LIMIT_PCT}%, transparent ${LIMIT_PCT}%)` }}>
                <span className="block h-1 rounded-sm" style={{ width: `${Math.min(100, (min / DAY_LIMIT_MIN) * LIMIT_PCT)}%`, background: over ? "var(--warn)" : d < today ? "var(--border-strong)" : "var(--faint)" }} />
                <span className="absolute -top-0.5 block h-2 w-[1.5px] bg-muted" style={{ left: `${LIMIT_PCT}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      <section aria-labelledby="day-h" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 id="day-h" className="m-0 text-[17px] font-semibold">{fullDow(day)}</h2>
          <span className={cx("font-mono text-xs", overMin || day === today ? "text-warn" : "text-faint")}>{day === today ? "TODAY · " : ""}{fmtHours(minutes)} of {fmtHours(DAY_LIMIT_MIN)}</span>
          {overMin > 0 && <span className="ml-auto rounded-lg border border-warn/45 bg-warn/10 px-2.5 py-1.5 font-mono text-xs text-warn">+{fmtHours(overMin)} over</span>}
        </div>
        {minutes > 0 && <LoadBar segments={segs} className="h-2.5" />}
        {tasks.length === 0 ? (
          <p className="m-0 rounded-[14px] border border-dashed border-line px-4 py-8 text-center text-[13.5px] text-muted">Nothing planned for this day.</p>
        ) : (
          <ul className="m-0 list-none overflow-hidden rounded-[14px] border border-line bg-surface p-0">
            {tasks.map((t) => {
              const done = t.status === "done";
              const p = proj.get(t.project_id ?? "");
              return (
                <li key={t.id} className="flex min-h-[62px] items-center gap-1.5 border-t border-line py-1.5 pr-3.5 pl-1 first:border-t-0">
                  <TaskCircle label={`${done ? "Mark not done" : "Complete"}: ${t.title}`} done={done} onClick={() => onToggleDone(t.id)} color={p?.color} />
                  <button type="button" onClick={() => onOpen(t.id)} className="flex min-w-0 flex-1 flex-col gap-[3px] py-1 text-left">
                    <span className={cx("text-[15px] leading-[1.3]", done && "text-faint line-through")}>{t.title}</span>
                    <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                      <ProjectSquare color={p?.color ?? "var(--faint)"} size={7} />{p?.name ?? "No project"}
                      <span className="ml-auto font-mono text-[11.5px] text-faint">{t.estimate_min ? fmtHours(t.estimate_min) : ""}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The phone's single suggested-link card (the most confident pending one). */
export function SuggestionCard({ model: m, onAccept, onDismiss }: { model: Model; onAccept: (id: string) => void; onDismiss: (id: string) => void }) {
  const s = m.suggestions[0];
  if (!s) return null;
  const title = (id: string) => m.graph.byId.get(id)?.title ?? "";
  return (
    <section aria-label="Suggested link" className="flex flex-col gap-2.5 rounded-[14px] border border-dashed border-ai-line bg-ai-soft p-3.5">
      <div className="flex items-start gap-2.5">
        <Sparkles size={16} aria-hidden strokeWidth={1.8} className="mt-0.5 shrink-0 text-accent" />
        <p className="m-0 text-sm leading-[1.45]">Do <strong className="font-semibold">{title(s.a)}</strong> before <strong className="font-semibold">{title(s.b)}</strong>? <span className="text-muted">{s.why}</span></p>
      </div>
      <div className="flex gap-2 pl-[26px]">
        <button type="button" onClick={() => onAccept(s.id)} aria-label={`Accept: ${title(s.a)} before ${title(s.b)}`} className="h-11 rounded-[11px] bg-accent px-[18px] text-sm font-semibold text-accent-fg">Accept</button>
        <button type="button" onClick={() => onDismiss(s.id)} aria-label={`Dismiss: ${title(s.a)} before ${title(s.b)}`} className="h-11 rounded-[11px] border border-line2 px-[18px] text-sm font-medium text-muted">Dismiss</button>
      </div>
    </section>
  );
}
