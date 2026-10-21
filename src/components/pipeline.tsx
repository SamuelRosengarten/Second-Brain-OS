"use client";
import Link from "next/link";
import { AlertTriangle, Check, Circle, Clock, Flag, Play, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { diffDays, HEALTH_LABEL, HORIZON_LABEL, HORIZONS, horizonOf, packMarkers, projectHue, projectStats, roomToRight, STATE_LABEL, taskState, timelineWindow, type Health, type PProject, type PTask, type TaskState } from "@/lib/pipeline";
import { addDays } from "@/lib/dates";
import { Badge, cx } from "./ui";

/* ---------- shared look ---------- */

const STATE_STYLE: Record<TaskState, { icon: LucideIcon; cls: string; text: string }> = {
  overdue: { icon: AlertTriangle, cls: "border-danger bg-danger/15 text-danger", text: "text-danger" },
  soon: { icon: Clock, cls: "border-warn bg-warn/15 text-warn", text: "text-warn" },
  doing: { icon: Play, cls: "border-info bg-info/15 text-info", text: "text-info" },
  todo: { icon: Circle, cls: "border-faint bg-surface2 text-muted", text: "text-muted" },
  undated: { icon: Circle, cls: "border-line bg-surface2 text-faint", text: "text-faint" },
  done: { icon: Check, cls: "border-ok bg-ok/15 text-ok", text: "text-ok" },
};
const HEALTH_TONE: Record<Health, "danger" | "warn" | "ok" | "neutral" | "info"> = { behind: "danger", "at-risk": "warn", "on-track": "ok", idle: "neutral", complete: "info" };

/** The project's color for stripes and bars. Lightness comes from a theme variable so it reads on dark and light. */
export const projectColor = (id: string): string => `hsl(${projectHue(id)} 62% var(--pl, 60%))`;

const fmtShort = (d: string): string => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const describe = (t: PTask, today: string): string => {
  const st = taskState(t, today);
  const when = t.status === "done" ? (t.completed_at ? `finished ${fmtShort(t.completed_at.slice(0, 10))}` : "done") : t.due_date ? `due ${fmtShort(t.due_date)}` : "no due date";
  return `${t.title}, ${STATE_LABEL[st].toLowerCase()}, ${when}, ${t.priority} priority`;
};

/* ---------- timeline (swimlanes) ---------- */

export const RANGES = [{ days: 14, label: "2 weeks", px: 44 }, { days: 42, label: "6 weeks", px: 20 }, { days: 90, label: "3 months", px: 10 }] as const;
const LABEL_W = "w-32 sm:w-56";
const ROW_H = 28;
const MARKER = 24;

function Progress({ s }: { s: ReturnType<typeof projectStats> }) {
  const pct = (n: number) => `${s.total ? (n / s.total) * 100 : 0}%`;
  const rest = s.total - s.done - s.overdue - s.doing;
  return (
    <div role="img" aria-label={`${s.done} of ${s.total} done${s.overdue ? `, ${s.overdue} overdue` : ""}${s.doing ? `, ${s.doing} in progress` : ""}`} className="flex h-1.5 w-full overflow-hidden rounded-full bg-line">
      <span style={{ width: pct(s.done) }} className="bg-ok" />
      <span style={{ width: pct(s.doing) }} className="bg-info" />
      <span style={{ width: pct(s.overdue) }} className="bg-danger" />
      <span style={{ width: pct(Math.max(0, rest)) }} className="bg-faint/40" />
    </div>
  );
}

export function PipelineTimeline({ projects, tasks, today, rangeDays, showDone, onOpen, linkProjects = true }: {
  projects: PProject[]; tasks: PTask[]; today: string; rangeDays: number; showDone: boolean; onOpen: (t: PTask) => void; linkProjects?: boolean;
}) {
  const px = RANGES.find((r) => r.days === rangeDays)?.px ?? 20;
  const win = useMemo(() => timelineWindow(tasks, today, rangeDays), [tasks, today, rangeDays]);
  const width = win.days * px;
  const todayX = (diffDays(win.from, today) + 0.5) * px;
  const scroller = useRef<HTMLDivElement>(null);

  // Start with "today" near the left edge so the near future is what you see first.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 140);
  }, [todayX, rangeDays]);

  // Week ticks (Mondays).
  const ticks = useMemo(() => {
    const out: { x: number; label: string; month: boolean }[] = [];
    const [y, m, d] = win.from.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const toMonday = (8 - (start.getDay() || 7)) % 7;
    for (let i = toMonday; i < win.days; i += 7) {
      const date = addDays(win.from, i);
      out.push({ x: i * px, label: fmtShort(date), month: Number(date.slice(8)) <= 7 });
    }
    return { list: out, firstMonday: toMonday };
  }, [win, px]);

  const lanes = projects.map((p) => {
    const mine = tasks.filter((t) => t.project_id === p.id);
    return { p, mine, stats: projectStats(mine, today, p) };
  });
  // Projects that need attention come first, then by how soon their next deadline is.
  const urgency: Record<Health, number> = { behind: 0, "at-risk": 1, "on-track": 2, idle: 3, complete: 4 };
  lanes.sort((a, b) => urgency[a.stats.health] - urgency[b.stats.health] || (a.stats.nextDue ?? "9999").localeCompare(b.stats.nextDue ?? "9999") || a.p.name.localeCompare(b.p.name));
  const loose = tasks.filter((t) => !t.project_id);
  if (loose.length) lanes.push({ p: { id: "", name: "No project", status: "active", target_date: null, goals: "" }, mine: loose, stats: projectStats(loose, today) });

  // Workload per day across the visible projects: busy days show as taller bars in the axis.
  const load = new Map<number, number>();
  for (const t of tasks) {
    if (t.status === "done" || !t.due_date) continue;
    const i = diffDays(win.from, t.due_date);
    if (i >= 0 && i < win.days) load.set(i, (load.get(i) ?? 0) + 1);
  }
  const gridStyle = { backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)", backgroundSize: `${7 * px}px 100%`, backgroundPosition: `${ticks.firstMonday * px}px 0` };

  return (
    <div
      ref={scroller}
      role="region"
      tabIndex={0}
      aria-label="Project timeline. Scrolls sideways; each marker is a task you can open."
      className="relative overflow-x-auto rounded-lg border border-line bg-surface focus-visible:outline-offset-2"
    >
      <div className="w-max min-w-full">
        {/* axis */}
        <div className="flex border-b border-line">
          <div className={cx("sticky left-0 z-20 shrink-0 border-r border-line bg-surface px-3 py-2 text-xs font-medium text-muted", LABEL_W)}>Project</div>
          <div className="relative h-9 shrink-0" style={{ width }}>
            {ticks.list.map((t) => (
              <span key={t.x} style={{ left: t.x + 4 }} className={cx("absolute top-2 text-xs whitespace-nowrap", t.month ? "font-semibold text-fg" : "text-muted")}>{t.label}</span>
            ))}
            {[...load.entries()].map(([i, n]) => (
              <span key={i} aria-hidden title={`${n} due`} style={{ left: i * px + 1, width: Math.max(3, px - 2), height: Math.min(n, 5) * 3 }} className={cx("absolute bottom-0 rounded-t-sm", n >= 4 ? "bg-warn" : "bg-accent/50")} />
            ))}
            <span style={{ left: todayX }} className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent" aria-hidden />
            <span style={{ left: todayX + 6 }} className="absolute bottom-0.5 rounded bg-accent px-1 text-[10px] leading-4 font-semibold text-accent-fg">Today</span>
          </div>
        </div>

        {lanes.length === 0 && <p className="p-6 text-sm text-muted">No projects yet. Create a project and add tasks with due dates to see them here.</p>}

        {lanes.map(({ p, mine, stats }) => {
          const color = p.id ? projectColor(p.id) : "var(--faint)";
          const visible = mine.filter((t) => (t.status === "done" ? showDone : !!t.due_date));
          const items: { item: PTask; x: number }[] = [];
          let later = 0;
          for (const t of visible) {
            const day = t.status === "done" ? (t.completed_at ?? t.due_date ?? "").slice(0, 10) : t.due_date!;
            if (!day) continue;
            const idx = diffDays(win.from, day);
            if (idx >= win.days) { later++; continue; }
            if (idx < 0 && t.status === "done") continue;
            items.push({ item: t, x: (Math.max(0, idx) + 0.5) * px });
          }
          const { placed, rows } = packMarkers(items, MARKER + 2);
          const room = roomToRight(placed, width);
          const height = rows * ROW_H + 16;
          const target = p.target_date ? diffDays(win.from, p.target_date) : null;
          return (
            <div key={p.id || "none"} role="group" aria-label={`${p.name}: ${HEALTH_LABEL[stats.health]}`} className="flex border-b border-line last:border-b-0">
              <div className={cx("sticky left-0 z-10 shrink-0 space-y-1.5 border-r border-l-[3px] border-r-line bg-surface px-3 py-2.5", LABEL_W)} style={{ borderLeftColor: color }}>
                <div className="flex items-start justify-between gap-2">
                  {linkProjects && p.id ? <Link href={`/projects/${p.id}`} className="min-w-0 truncate text-[13px] font-medium hover:underline">{p.name}</Link> : <span className="min-w-0 truncate text-[13px] font-medium">{p.name}</span>}
                </div>
                <Badge tone={HEALTH_TONE[stats.health]}>{HEALTH_LABEL[stats.health]}</Badge>
                <Progress s={stats} />
                <p className="text-xs text-muted">
                  <span className="tnum">{stats.done}/{stats.total}</span> done{stats.overdue ? <> · <span className="text-danger">{stats.overdue} overdue</span></> : null}
                  {stats.undated ? <span className="block text-faint">{stats.undated} without a date</span> : null}
                </p>
              </div>
              <div className="relative shrink-0" style={{ width, minHeight: Math.max(height, 76), ...gridStyle }}>
                <span aria-hidden className="absolute inset-y-0 left-0 bg-danger/5" style={{ width: todayX }} />
                <span aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent/60" style={{ left: todayX }} />
                {target !== null && target >= 0 && target < win.days && (
                  <span className="absolute inset-y-0 border-l border-dashed border-faint" style={{ left: (target + 0.5) * px }}>
                    <span className="absolute top-0.5 left-1 flex items-center gap-1 text-[10px] whitespace-nowrap text-faint"><Flag size={10} aria-hidden />Target {fmtShort(p.target_date!)}</span>
                  </span>
                )}
                {placed.map((pl) => {
                  const t = pl.item;
                  const st = taskState(t, today);
                  const S = STATE_STYLE[st];
                  const top = 8 + pl.row * ROW_H;
                  const free = room.get(pl)! - MARKER / 2 - 10;
                  return (
                    <span key={t.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(t)}
                        title={describe(t, today)}
                        aria-label={describe(t, today)}
                        style={{ left: pl.x - MARKER / 2, top, width: MARKER, height: MARKER }}
                        className={cx("absolute grid place-items-center rounded-full border-2 transition-transform hover:z-10 hover:scale-110 focus-visible:z-10", S.cls, t.priority === "high" && st !== "done" && "ring-2 ring-offset-1 ring-offset-surface", t.priority === "high" && st !== "done" && "ring-current", st === "done" && "opacity-75")}
                      >
                        <S.icon size={12} aria-hidden strokeWidth={2.5} />
                      </button>
                      {free >= 70 && (
                        <span aria-hidden style={{ left: pl.x + MARKER / 2 + 4, top: top + 4, maxWidth: free }} className={cx("pointer-events-none absolute truncate text-xs", st === "done" ? "text-faint line-through" : "text-muted")}>{t.title}</span>
                      )}
                    </span>
                  );
                })}
                {later > 0 && <span className="absolute right-2 bottom-1 rounded bg-surface2 px-1.5 py-0.5 text-xs text-muted">+{later} later</span>}
                {items.length === 0 && later === 0 && <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs text-faint" style={{ left: Math.max(12, todayX + 12) }}>Nothing scheduled in this range</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
