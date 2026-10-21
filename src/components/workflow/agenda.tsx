"use client";
import { CalendarClock, Check } from "lucide-react";
import { useId, useState } from "react";
import { addDays } from "@/lib/dates";
import { diffDays } from "@/lib/pipeline";
import { Dialog } from "../ui";
import { BADGE, fmtDay, tint, type Model } from "./model";

interface Group { key: string; title: string; sub: string; tone: "late" | "today" | "plain"; ids: string[]; load: number }

/**
 * Phone layout of the timeline: a vertical agenda, one section per day. Dragging a tiny chip across a 390px grid is
 * not workable with a thumb, so each task has a large Move button instead; everything else (status, dependencies,
 * critical path, done toggle) matches the wide timeline.
 */
export function Agenda({ model: m, days, selected, onSelect, onToggleDone, onMove }: {
  model: Model; days: number; selected: string | null; onSelect: (id: string) => void; onToggleDone: (id: string) => void; onMove: (id: string) => void;
}) {
  const visible = new Set(m.visibleProjects.map((p) => p.id));
  const order = new Map(m.projects.map((p, i) => [p.id, i]));
  const mine = m.tasks.filter((t) => visible.has(t.project_id ?? ""));
  const byOrder = (a: string, b: string) => (order.get(m.graph.byId.get(a)?.project_id ?? "") ?? 99) - (order.get(m.graph.byId.get(b)?.project_id ?? "") ?? 99) || (m.graph.byId.get(a)?.title ?? "").localeCompare(m.graph.byId.get(b)?.title ?? "");
  const groups: Group[] = [];
  const late = mine.filter((t) => t.due_date && t.due_date < m.today && t.status !== "done").map((t) => t.id).sort(byOrder);
  if (late.length) groups.push({ key: "late", title: "Overdue", sub: `${late.length} to catch up on`, tone: "late", ids: late, load: late.length });
  let later = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(m.today, i);
    const ids = mine.filter((t) => t.due_date === date).map((t) => t.id).sort(byOrder);
    const doneToday = i === 0 ? mine.filter((t) => t.status === "done" && t.due_date && t.due_date < m.today).map((t) => t.id) : [];
    const all = [...ids, ...doneToday];
    if (!all.length) continue;
    groups.push({ key: date, title: i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtDay(date).split(",")[0], sub: fmtDay(date), tone: i === 0 ? "today" : "plain", ids: all, load: all.filter((id) => m.graph.byId.get(id)!.status !== "done").length });
  }
  for (const t of mine) if (t.due_date && diffDays(m.today, t.due_date) >= days) later++;
  const nodate = mine.filter((t) => !t.due_date && t.status !== "done").map((t) => t.id).sort(byOrder);
  if (nodate.length) groups.push({ key: "nodate", title: "No date", sub: "Tap Move to schedule", tone: "plain", ids: nodate, load: 0 });
  const proj = new Map(m.projects.map((p) => [p.id, p]));

  if (!groups.length) return <p className="p-5 text-sm text-[var(--wf-muted)]">Nothing due in this range{later ? `, and ${later} later` : ""}. Add due dates to your tasks to plan them here.</p>;
  return (
    <div className="flex flex-col gap-5 p-3">
      {groups.map((g) => (
        <section key={g.key} aria-label={`${g.title}, ${g.ids.length} tasks`}>
          <h3 className="mb-2 flex items-baseline gap-2 px-1 text-[13px] font-semibold" style={{ color: g.tone === "late" ? "var(--wf-late)" : g.tone === "today" ? "var(--wf-acc)" : "var(--wf-strong)" }}>
            {g.title}
            <span className="text-xs font-normal text-[var(--wf-muted)]">{g.sub}</span>
            {g.load > 0 && <span className="ml-auto rounded-full px-2 text-[11px] leading-[18px] font-semibold text-[var(--wf-text)]" style={{ background: g.load === 1 ? "var(--wf-load1)" : g.load === 2 ? "var(--wf-load2)" : "var(--wf-load3)" }}>{g.load} due</span>}
          </h3>
          <ul className="flex flex-col gap-2">
            {g.ids.map((id) => {
              const t = m.graph.byId.get(id)!;
              const p = proj.get(t.project_id ?? "");
              const color = p?.color ?? "var(--wf-note)";
              const st = m.status.get(id)!;
              const b = BADGE[st];
              const done = st === "done";
              const crit = m.critOn && m.crit.set.has(id);
              const waits = (m.graph.depIn.get(id) ?? []).filter((d) => m.graph.byId.get(d)?.status !== "done");
              const unblocks = m.graph.depOut.get(id) ?? [];
              const sel = selected === id;
              return (
                <li key={id} className="rounded-xl" style={{ background: tint(color, 9), border: `${crit ? 2 : 1}px solid ${crit ? "var(--wf-crit)" : sel ? tint(color, 87) : st === "overdue" || st === "conflict" ? tint("var(--wf-bad)", 80) : tint(color, 33)}`, opacity: m.critOn && !crit ? 0.45 : done ? 0.6 : 1, boxShadow: sel ? "0 0 0 2px var(--wf-panel), 0 0 0 4px var(--wf-acc)" : undefined }}>
                  <div className="flex items-start">
                    <button type="button" aria-label={`${done ? "Mark not done" : "Mark done"}: ${t.title}`} aria-pressed={done} onClick={() => onToggleDone(id)} className="grid size-12 flex-none place-items-center border-0 bg-transparent p-0">
                      <span className="grid size-5 place-items-center rounded-full" style={{ border: `1.5px solid ${color}`, background: done ? color : "transparent" }}>
                        <Check size={12} strokeWidth={4} aria-hidden style={{ opacity: done ? 1 : 0, color: "var(--wf-panel)" }} />
                      </span>
                    </button>
                    <button type="button" onClick={() => onSelect(id)} className="min-w-0 flex-1 border-0 bg-transparent py-2.5 pr-1 text-left">
                      <span className={`block text-[14px] leading-snug ${done ? "text-[var(--wf-muted)] line-through" : "text-[var(--wf-strong)]"}`}>{t.title}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--wf-muted)]">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
                        <span className="min-w-0 truncate">{p?.name ?? "No project"}</span>
                        <span className="rounded-full px-2 py-px text-[11px] font-medium" style={{ color: b.fg, background: b.bg }}>{b.label}</span>
                      </span>
                      {(waits.length > 0 || unblocks.length > 0) && (
                        <span className="mt-1 block text-xs text-[var(--wf-muted)]">
                          {waits.length > 0 && <>Waits for {waits.length === 1 ? m.graph.byId.get(waits[0])!.title : `${waits.length} tasks`}</>}
                          {waits.length > 0 && unblocks.length > 0 && " · "}
                          {unblocks.length > 0 && <>Unblocks {unblocks.length}</>}
                        </span>
                      )}
                    </button>
                    <button type="button" aria-label={`Move date of ${t.title}`} onClick={() => onMove(id)} className="grid size-12 flex-none place-items-center border-0 bg-transparent p-0 text-[var(--wf-soft)]">
                      <CalendarClock size={18} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {later > 0 && <p className="px-1 text-xs text-[var(--wf-muted)]">+{later} more beyond this range. Choose a longer range to see them.</p>}
    </div>
  );
}

/** Pick a new due date with big buttons and a date field (used from the phone agenda and the inspector). */
export function MoveDialog({ open, title, current, today, onClose, onPick }: { open: boolean; title: string; current: string | null; today: string; onClose: () => void; onPick: (date: string | null) => void }) {
  const id = useId();
  const [custom, setCustom] = useState("");
  const quick: { label: string; value: string | null }[] = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "In 3 days", value: addDays(today, 3) },
    { label: "Next week", value: addDays(today, 7) },
    { label: "No date", value: null },
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Move due date" noKeyboardOnTouch footer={<button type="button" onClick={onClose} className="h-11 rounded-lg px-4 text-sm text-muted">Cancel</button>}>
      <div className="space-y-3">
        <p className="text-sm">{title}</p>
        <p className="text-xs text-faint">Now: {current ? fmtDay(current) : "no due date"}</p>
        <div className="grid grid-cols-2 gap-2">
          {quick.map((q) => (
            <button key={q.label} type="button" onClick={() => onPick(q.value)} aria-pressed={q.value === current} className="h-12 rounded-lg border border-line bg-surface text-sm font-medium text-fg hover:bg-hover aria-pressed:border-accent aria-pressed:text-accent">{q.label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor={id} className="sr-only">Pick a date</label>
          <input id={id} type="date" min={today} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-12 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-fg" />
          <button type="button" disabled={!custom} onClick={() => onPick(custom)} className="h-12 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-50">Set</button>
        </div>
      </div>
    </Dialog>
  );
}
