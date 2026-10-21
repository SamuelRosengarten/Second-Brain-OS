"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { edgeKey, forceLayout, type GEdge, type GNode } from "@/lib/workflow-logic";
import { BADGE, fmtDay, shortDate, type Model } from "./model";
import { useElementWidth } from "./hooks";

const R = { project: 11, task: 7, note: 5.5, tag: 6, capture: 5 } as const;
const SUG = "var(--wf-sug)";
const BAD = "var(--wf-bad)";
const POS_KEY = "sbos-workflow-positions";

export interface GraphProps {
  model: Model;
  focus: string | null;
  sets: { chain: Set<string>; lit: Set<string> } | null;
  selected: string | null;
  show: { task: boolean; note: boolean; tag: boolean; capture: boolean; sugg: boolean };
  /** Pull each project's tasks together in the layout. */
  group?: boolean;
  /** Canvas height in px on wide screens (phones size it from the number of tasks). */
  height?: number;
  /** Phone layout: taller canvas, bigger touch targets, labels only where they matter. */
  compact: boolean;
  resetKey: number;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

type Frac = Record<string, { fx: number; fy: number }>;

function loadPositions(bucket: string): Frac {
  try {
    const all = JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") as Record<string, Frac>;
    return all[bucket] ?? {};
  } catch {
    return {};
  }
}
function savePositions(bucket: string, frac: Frac): void {
  try {
    const all = JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") as Record<string, Frac>;
    all[bucket] = frac;
    localStorage.setItem(POS_KEY, JSON.stringify(all));
  } catch {
    // layout just is not remembered
  }
}

export function GraphCanvas({ model: m, focus, sets, selected, show, group, height, compact, resetKey, onSelect, onHover }: GraphProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const avail = useElementWidth(wrap);
  const W = Math.max(avail, 300);
  const H = compact ? Math.max(620, Math.min(1200, 420 + m.tasks.length * 20)) : (height ?? 800);
  const bucket = compact ? "phone" : "wide";
  const [frac, setFrac] = useState<Frac>({});
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const suppress = useRef(false);

  useEffect(() => { setFrac(loadPositions(bucket)); }, [bucket, resetKey]);
  useEffect(() => { if (resetKey > 0) { savePositions(bucket, {}); setFrac({}); } }, [resetKey, bucket]);

  // Which nodes exist right now (the toggles and hidden projects change this).
  const nodes = useMemo(() => {
    const out: (GNode & { label: string; sub: string })[] = [];
    const hiddenIds = new Set(m.projects.filter((p) => !m.visibleProjects.some((v) => v.id === p.id)).map((p) => p.id));
    for (const p of m.projects) if (p.id) out.push({ id: p.id, kind: "project", label: p.name, sub: "" });
    for (const t of m.tasks) {
      if (hiddenIds.has(t.project_id ?? "") || !show.task) continue;
      const st = m.status.get(t.id)!;
      const extra = st === "blocked" || st === "overdue" || st === "conflict" ? ` · ${BADGE[st].label}` : st === "done" ? " · Done" : "";
      out.push({ id: t.id, kind: "task", label: t.title.length > 34 ? `${t.title.slice(0, 33)}…` : t.title, sub: `${t.due_date ? ` · ${shortDate(t.due_date)}` : " · no date"}${extra}` });
    }
    for (const e of m.entities.values()) {
      if ((e.kind === "note" && show.note) || (e.kind === "tag" && show.tag) || (e.kind === "capture" && show.capture)) out.push({ id: e.id, kind: e.kind, label: e.title, sub: "" });
    }
    return out;
  }, [m, show.task, show.note, show.tag, show.capture]);
  const ids = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(() => m.links.filter((l) => ids.has(l.a) && ids.has(l.b) && (l.kind !== "sugg" || show.sugg)), [m.links, ids, show.sugg]);

  // Grouping adds invisible pulls between tasks of one project, so they sit together; the drawn edges do not change.
  const layoutEdges = useMemo(() => {
    if (!group) return edges as GEdge[];
    const extra: GEdge[] = [];
    const last = new Map<string, string>();
    for (const n of nodes) {
      if (n.kind !== "task") continue;
      const pid = m.graph.byId.get(n.id)?.project_id ?? "";
      const prev = last.get(pid);
      if (prev) extra.push({ a: prev, b: n.id });
      last.set(pid, n.id);
    }
    return [...(edges as GEdge[]), ...extra];
  }, [edges, group, nodes, m.graph]);
  const base = useMemo(() => forceLayout(nodes, layoutEdges, W, H), [nodes, layoutEdges, W, H]);
  const pos = (id: string) => {
    const f = frac[id];
    if (f) return { x: Math.min(W - 24, Math.max(24, f.fx * W)), y: Math.min(H - 24, Math.max(24, f.fy * H)) };
    return base.get(id) ?? { x: W / 2, y: H / 2 };
  };

  const move = (id: string, x: number, y: number, persist: boolean) => {
    const cx = Math.min(W - 24, Math.max(24, x));
    const cy = Math.min(H - 24, Math.max(24, y));
    setFrac((f) => {
      const next = { ...f, [id]: { fx: cx / W, fy: cy / H } };
      if (persist) savePositions(bucket, next);
      return next;
    });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    d.moved = true;
    suppress.current = true;
    move(d.id, (e.clientX - r.left) / ((r.width / W) || 1), (e.clientY - r.top) / ((r.height / H) || 1), false);
  };
  useEffect(() => {
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d?.moved) setFrac((f) => { savePositions(bucket, f); return f; });
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [bucket]);

  const isLit = (id: string) => !sets || sets.lit.has(id);
  const critOn = m.critOn;

  // Labels are placed greedily: projects, the pinned node and the traced neighbours always show; the rest only where they do not
  // collide with a label already placed (hover or select a node to see its label anyway).
  const labelSet = new Set<string>();
  {
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rank = (n: (typeof nodes)[number]) => (n.kind === "project" ? 0 : selected === n.id ? 1 : sets?.lit.has(n.id) ? 2 : n.kind === "task" ? 3 : 4);
    for (const n of [...nodes].sort((x, y) => rank(x) - rank(y))) {
      const r = R[n.kind];
      const p = pos(n.id);
      const must = rank(n) <= 2;
      if (compact && !must) continue;
      const wEst = (n.label.length + n.sub.length) * (n.kind === "project" ? 7.4 : 6.4) + 8;
      const off = Math.max(r + 8, (compact ? 36 : Math.max(r * 2, 24)) / 2 + 2);
      const flip = n.kind !== "project" && p.x + off + wEst + 8 > W;
      const box = n.kind === "project"
        ? { x0: p.x - wEst / 2, x1: p.x + wEst / 2, y0: p.y + off - 1, y1: p.y + off + 17 }
        : flip ? { x0: p.x - off - wEst, x1: p.x - off, y0: p.y - 9, y1: p.y + 9 } : { x0: p.x + off, x1: p.x + off + wEst, y0: p.y - 9, y1: p.y + 9 };
      if (!must && boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      boxes.push(box);
      labelSet.add(n.id);
    }
  }

  return (
    <div ref={wrap} className="w-full overflow-hidden">
      <div
        className="relative select-none"
        style={{ width: W, height: H, backgroundImage: "radial-gradient(var(--wf-dots) 1px, transparent 1.2px)", backgroundSize: "26px 26px" }}
        onPointerMove={onPointerMove}
      >
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden>
          {edges.map((e) => {
            const A = pos(e.a);
            const B = pos(e.b);
            const hot = !!sets && (e.a === focus || e.b === focus || (e.kind === "dep" && sets.chain.has(e.a) && sets.chain.has(e.b)));
            const baseStyle = e.kind === "dep" ? { c: "var(--wf-dep)", w: 1.5, dash: "none" } : e.kind === "sugg" ? { c: SUG, w: 1.6, dash: "3 4" } : e.kind === "link" ? { c: "var(--wf-link)", w: 1.3, dash: "4 5" } : { c: "var(--wf-edge)", w: 1, dash: "none" };
            let color = baseStyle.c; let sw = baseStyle.w; let op = 1;
            if (sets) { if (hot) { color = e.kind === "sugg" ? SUG : "var(--wf-acc)"; sw = baseStyle.w + 0.7; } else op = 0.1; }
            const ta = m.graph.byId.get(e.a); const tb = m.graph.byId.get(e.b);
            if (e.kind === "dep" && ta && tb && ta.status !== "done" && ta.due_date && tb.due_date && ta.due_date > tb.due_date) { color = BAD; sw = 2; }
            if (critOn) { if (e.kind === "dep" && m.crit.edges.has(edgeKey(e.a, e.b))) { color = "var(--wf-crit)"; sw = 2.6; op = 1; } else op = Math.min(op, 0.2); }
            let head = "";
            if (e.kind === "dep" || e.kind === "sugg") {
              const dx = B.x - A.x; const dy = B.y - A.y; const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / len; const uy = dy / len; const rr = R[m.entities.get(e.b)!.kind] + 4;
              const qx = B.x - ux * rr; const qy = B.y - uy * rr; const px = -uy; const py = ux;
              head = `M ${qx.toFixed(1)} ${qy.toFixed(1)} L ${(qx - ux * 9 + px * 4).toFixed(1)} ${(qy - uy * 9 + py * 4).toFixed(1)} L ${(qx - ux * 9 - px * 4).toFixed(1)} ${(qy - uy * 9 - py * 4).toFixed(1)} Z`;
            }
            return (
              <g key={`${e.kind}:${e.a}>${e.b}`} opacity={op}>
                <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={color} strokeWidth={sw} strokeDasharray={baseStyle.dash} strokeLinecap="round" />
                {head && <path d={head} fill={color} />}
              </g>
            );
          })}
        </svg>

        {nodes.map((n) => {
          const e = m.entities.get(n.id)!;
          const p = pos(n.id);
          const r = R[n.kind];
          const d = r * 2;
          const col = e.color;
          const isSel = selected === n.id;
          let fill: string = col; let border = "none"; let shadow = n.kind === "project" ? `0 0 0 4px color-mix(in srgb, ${col} 20%, transparent)` : "none"; let radius = "50%";
          if (n.kind === "task") {
            const st = m.status.get(n.id)!;
            if (st === "blocked") { fill = "var(--wf-panel)"; border = `2px solid ${col}`; }
            if (st === "done") { fill = `color-mix(in srgb, ${col} 33%, transparent)`; border = `1.5px solid ${col}`; }
            if (st === "overdue" || st === "conflict") shadow = `0 0 0 3px color-mix(in srgb, ${BAD} 60%, transparent)`;
            if (critOn && m.crit.set.has(n.id)) shadow = "0 0 0 3px var(--wf-crit)";
          }
          if (n.kind === "tag") { fill = "var(--wf-panel)"; border = `1.5px solid ${col}`; }
          if (n.kind === "capture") radius = "2px";
          if (isSel) shadow = "0 0 0 3px var(--wf-panel), 0 0 0 5px var(--wf-acc)";
          const faded = n.kind === "project" && !m.visibleProjects.some((v) => v.id === n.id);
          let op = (isLit(n.id) ? 1 : 0.18) * (faded ? 0.35 : 1);
          if (critOn && n.kind === "task" && !m.crit.set.has(n.id)) op = Math.min(op, 0.3);
          const est = (n.label.length + n.sub.length) * 6.4 + 16;
          const flip = n.kind !== "project" && p.x + r + 8 + est > W - 8;
          const showLabel = labelSet.has(n.id);
          const hit = compact ? 36 : Math.max(d, 24);
          const aria = n.kind === "task" ? `Task: ${n.label}${n.sub}` : `${n.kind[0].toUpperCase()}${n.kind.slice(1)}: ${e.title}`;
          return (
            <div key={n.id} style={{ position: "absolute", left: p.x, top: p.y, width: 0, height: 0, opacity: op }}>
              <button
                type="button"
                aria-label={aria}
                aria-pressed={isSel}
                title={n.kind === "task" ? `${e.title}${m.graph.byId.get(n.id)?.due_date ? `. Due ${fmtDay(m.graph.byId.get(n.id)!.due_date!)}` : ""}` : e.title}
                onPointerDown={(ev) => { if (ev.button !== 0) return; drag.current = { id: n.id, moved: false }; suppress.current = false; }}
                onClick={() => { if (suppress.current) { suppress.current = false; return; } onSelect(selected === n.id ? null : n.id); }}
                onKeyDown={(ev) => {
                  const step = ev.shiftKey ? 40 : 12;
                  const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
                  const dy = ev.key === "ArrowUp" ? -step : ev.key === "ArrowDown" ? step : 0;
                  if (!dx && !dy) return;
                  ev.preventDefault();
                  move(n.id, p.x + dx, p.y + dy, true);
                }}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(n.id)}
                onBlur={() => onHover(null)}
                style={{ position: "absolute", left: -hit / 2, top: -hit / 2, width: hit, height: hit, padding: 0, border: 0, background: "transparent", display: "grid", placeItems: "center", cursor: "grab", touchAction: "none" }}
              >
                <span aria-hidden style={{ display: "block", boxSizing: "border-box", width: d, height: d, border, borderRadius: radius, background: fill, boxShadow: shadow }} />
              </button>
              {showLabel && (
                <div
                  aria-hidden
                  style={
                    n.kind === "project"
                      ? { position: "absolute", left: Math.max(8 - p.x, Math.min(-est / 2, W - 8 - p.x - est)), top: Math.max(r + 7, hit / 2 + 2), whiteSpace: "nowrap", fontSize: 13, lineHeight: "18px", fontWeight: 600, color: "var(--wf-strong)", pointerEvents: "none", textShadow: "0 0 4px var(--wf-panel), 0 0 4px var(--wf-panel)" }
                      : { position: "absolute", [flip ? "right" : "left"]: Math.max(r + 8, hit / 2 + 2), top: -9, textAlign: flip ? "right" : undefined, whiteSpace: "nowrap", fontSize: 12, lineHeight: "18px", fontWeight: 500, color: "var(--wf-soft)", pointerEvents: "none", textShadow: "0 0 4px var(--wf-panel), 0 0 4px var(--wf-panel)" }
                  }
                >
                  <span>{n.label}</span>
                  <span style={{ color: "var(--wf-muted)", fontWeight: 400 }}>{n.sub}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
