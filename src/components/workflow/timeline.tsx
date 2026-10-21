"use client";
import { Check } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { addDays } from "@/lib/dates";
import { edgeKey, layoutTimeline, TL } from "@/lib/workflow-logic";
import { BADGE, dowOf, DOW_NAMES, fmtDay, MONTHS, tint, type Model } from "./model";
import { useElementWidth } from "./hooks";

export interface TimelineProps {
  model: Model;
  days: number;
  focus: string | null;
  sets: { chain: Set<string>; lit: Set<string> } | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onToggleDone: (id: string) => void;
  /** Called continuously while a chip is dragged (preview) and once more on drop (commit). */
  onDue: (id: string, date: string, commit: boolean) => void;
}

const SUG = "var(--wf-sug)";
const BAD = "var(--wf-bad)";

/** The design's day-grid timeline: one lane per project, one chip per task on its due day, arrows for dependencies. */
export function TimelineCanvas({ model: m, days, focus, sets, selected, onSelect, onHover, onToggleDone, onDue }: TimelineProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const avail = useElementWidth(wrap);
  // `last` is the most recent date previewed; the drop commits that, never a value read back from a (possibly stale) render.
  const drag = useRef<{ id: string; grab: number; moved: boolean; last: string | null } | null>(null);
  const suppressClick = useRef(false);
  const visibleIds = m.visibleProjects.map((p) => p.id);
  const tasks = m.tasks.filter((t) => visibleIds.includes(t.project_id ?? ""));
  const L = layoutTimeline({ tasks, projectIds: visibleIds, today: m.today, days, width: Math.max(avail, 320) });
  const proj = new Map(m.projects.map((p) => [p.id, p]));
  const lit = (id: string) => !sets || sets.lit.has(id);

  // Pressing the mouse button on a chip starts a drag; moving over the canvas changes the date it would land on.
  const dayAt = (clientX: number, rect: DOMRect, grab: number): number => {
    const mx = (clientX - rect.left) / ((rect.width / L.width) || 1);
    return Math.max(0, Math.min(days - 1, Math.round((mx - grab - TL.X0 - 6) / L.colW)));
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const ix = dayAt(e.clientX, e.currentTarget.getBoundingClientRect(), d.grab);
    const date = addDays(m.today, ix);
    const cur = m.graph.byId.get(d.id)?.due_date;
    if (date !== (d.last ?? cur)) { d.moved = true; d.last = date; suppressClick.current = true; onDue(d.id, date, false); }
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved && d.last) onDue(d.id, d.last, true);
  };
  useEffect(() => {
    const up = () => endDrag();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  });

  const edgeParts: { d: string; head: string; color: string; sw: number; dash: string; op: number; key: string }[] = [];
  let k = 0;
  const addEdge = (a: string, b: string, kind: "dep" | "sugg") => {
    const A = L.pos.get(a);
    const B = L.pos.get(b);
    if (!A || !B) return;
    const x0 = Math.max(4, Math.min(A.x, B.x) - 12 - (k % 5) * 5); k++;
    const hot = !!sets && ((sets.chain.has(a) && sets.chain.has(b)) || a === focus || b === focus);
    const dim = !!sets && !(hot || (sets.lit.has(a) && sets.lit.has(b)));
    const conflict = kind === "dep" && m.graph.byId.get(a)?.status !== "done" && !!m.graph.byId.get(a)?.due_date && !!m.graph.byId.get(b)?.due_date && m.graph.byId.get(a)!.due_date! > m.graph.byId.get(b)!.due_date!;
    const isCrit = m.critOn && m.crit.edges.has(edgeKey(a, b));
    let color = kind === "sugg" ? SUG : "var(--wf-dep)";
    let sw = kind === "sugg" ? 1.6 : 1.5;
    let op = dim ? 0.15 : 1;
    if (conflict) { color = BAD; sw = 2; }
    if (hot && !conflict) { color = kind === "sugg" ? SUG : "var(--wf-acc)"; sw = 2; }
    if (isCrit) { color = "var(--wf-crit)"; sw = 2.6; op = 1; } else if (m.critOn) op = Math.min(op, 0.2);
    edgeParts.push({
      key: `${kind}:${a}>${b}`, color, sw, op, dash: kind === "sugg" ? "3 4" : "none",
      d: `M ${A.x} ${A.y} H ${x0} V ${B.y} H ${B.x - 9}`,
      head: `M ${B.x - 1} ${B.y} L ${B.x - 9} ${B.y - 4} L ${B.x - 9} ${B.y + 4} Z`,
    });
  };
  for (const d of m.deps) addEdge(d.a, d.b, "dep");
  for (const s of m.suggestions) addEdge(s.a, s.b, "sugg");

  const narrow = L.narrow;
  return (
    <div ref={wrap} className="w-full">
      <div role="region" tabIndex={0} aria-label="Workflow timeline. Scrolls sideways. Focus a task and press the left or right arrow to move its due date by a day." className="overflow-x-auto focus-visible:outline-offset-[-2px]">
        <div className="relative" style={{ width: L.width, height: L.height }} onPointerMove={onMove}>
          {L.cols.map((c) => {
            const dw = dowOf(c.date);
            const dom = Number(c.date.slice(8));
            const n = c.load;
            const head: CSSProperties = { display: "flex", flexDirection: "column", gap: 1, padding: `12px 0 0 ${narrow ? 5 : 10}px` };
            return (
              <div key={c.date} style={{ position: "absolute", left: c.x, top: 0, width: L.colW, height: L.height, boxSizing: "border-box", borderLeft: `1px solid ${c.today ? "var(--wf-today-line)" : "var(--wf-grid)"}`, background: c.today ? "var(--wf-today-bg)" : c.weekend ? "var(--wf-weekend)" : "transparent" }}>
                <div style={head}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: c.today ? "var(--wf-acc)" : "var(--wf-muted)" }}>{narrow ? (dom === 1 ? MONTHS[Number(c.date.slice(5, 7)) - 1] : DOW_NAMES[dw].charAt(0)) : c.today ? "Today" : DOW_NAMES[dw]}</span>
                  <span style={{ fontSize: narrow ? 12 : 16, fontWeight: 600, color: "var(--wf-text)" }}>{narrow ? dom : dom === 1 || c.today ? `${MONTHS[Number(c.date.slice(5, 7)) - 1]} ${dom}` : dom}</span>
                  <span style={{ marginTop: 6, alignSelf: "flex-start", height: 18, boxSizing: "border-box", padding: `0 ${narrow ? 5 : 8}px`, borderRadius: 9, fontSize: 11, lineHeight: "18px", fontWeight: 600, color: "var(--wf-text)", background: n === 0 ? "transparent" : n === 1 ? "var(--wf-load1)" : n === 2 ? "var(--wf-load2)" : "var(--wf-load3)" }}>
                    {n > 0 ? (narrow ? String(n) : `${n} due`) : ""}
                  </span>
                </div>
              </div>
            );
          })}

          {L.lanes.map((l) => {
            const p = proj.get(l.projectId);
            if (!p) return null;
            return (
              <div key={l.projectId} style={{ position: "absolute", left: TL.X0, top: l.y, width: L.width - TL.X0 - 16, height: TL.LANEH, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--wf-line2)", fontSize: 13 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
                <span style={{ fontWeight: 600, color: "var(--wf-strong)" }}>{p.name}</span>
                <span style={{ color: "var(--wf-muted)" }}>{p.open} open</span>
                {l.later > 0 && <span style={{ color: "var(--wf-muted)" }}>+{l.later} later</span>}
                {l.undated > 0 && <span style={{ color: "var(--wf-muted)" }}>{l.undated} no date</span>}
              </div>
            );
          })}

          <svg width={L.width} height={L.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden>
            {edgeParts.map((e) => (
              <g key={e.key} opacity={e.op}>
                <path d={e.d} fill="none" stroke={e.color} strokeWidth={e.sw} strokeDasharray={e.dash} strokeLinejoin="round" />
                <path d={e.head} fill={e.color} />
              </g>
            ))}
          </svg>

          {L.chips.map((c) => {
            const t = m.graph.byId.get(c.id)!;
            const p = proj.get(t.project_id ?? "");
            const color = p?.color ?? "var(--wf-note)";
            const st = m.status.get(c.id)!;
            const b = BADGE[st];
            const isSel = selected === c.id;
            const hot = focus === c.id;
            const crit = m.critOn && m.crit.set.has(c.id);
            const done = st === "done";
            let op = 1;
            if (!lit(c.id)) op = 0.3;
            if (m.critOn && !crit) op = Math.min(op, 0.35);
            if (done) op = Math.min(op, 0.55);
            const border = crit ? "var(--wf-crit)" : isSel || hot ? tint(color, 87) : st === "conflict" || st === "overdue" ? tint(BAD, 80) : tint(color, 33);
            return (
              <div
                key={c.id}
                style={{ position: "absolute", left: c.x, top: c.y, width: c.w, height: TL.CHIPH, boxSizing: "border-box", display: "flex", alignItems: "center", background: tint(color, 11), border: `${crit ? 2 : 1}px solid ${border}`, borderRadius: 8, opacity: op, boxShadow: isSel ? "0 0 0 2px var(--wf-panel), 0 0 0 4px var(--wf-acc)" : undefined }}
              >
                <button type="button" aria-label={`${done ? "Mark not done" : "Mark done"}: ${t.title}`} aria-pressed={done} onClick={() => onToggleDone(c.id)} style={{ flex: "none", width: 36, height: 36, padding: 0, border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, boxSizing: "border-box", borderRadius: "50%", border: `1.5px solid ${color}`, background: done ? color : "transparent" }}>
                    <Check size={10} strokeWidth={4} aria-hidden style={{ opacity: done ? 1 : 0, color: "var(--wf-panel)" }} />
                  </span>
                </button>
                <button
                  type="button"
                  title={`${t.title}. Due ${fmtDay(t.due_date!)}. ${b.label}.`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    const wr = e.currentTarget.parentElement!.getBoundingClientRect();
                    drag.current = { id: c.id, grab: Math.max(0, (e.clientX - wr.left) / ((wr.width / c.w) || 1)), moved: false, last: null };
                    suppressClick.current = false;
                  }}
                  onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(selected === c.id ? null : c.id); }}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    e.preventDefault();
                    const cur = t.due_date!;
                    const next = addDays(cur, e.key === "ArrowLeft" ? -1 : 1);
                    if (next >= m.today) onDue(c.id, next, true);
                  }}
                  onMouseEnter={() => onHover(c.id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(c.id)}
                  onBlur={() => onHover(null)}
                  style={{ flex: 1, minWidth: 0, height: 36, padding: "0 10px 0 0", border: 0, background: "transparent", display: "flex", alignItems: "center", gap: 8, textAlign: "left", color: done ? "var(--wf-muted)" : "var(--wf-strong)", fontSize: 13, cursor: "grab", touchAction: "none" }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: done ? "line-through" : undefined }}>{t.title}</span>
                  <span style={{ flex: "none", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 500, lineHeight: "16px", color: b.fg, background: b.bg }}>{b.label}</span>
                  <span className="sr-only"> due {fmtDay(t.due_date!)}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
