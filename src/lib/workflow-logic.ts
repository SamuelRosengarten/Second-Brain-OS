/**
 * Pure logic behind the Workflow page (no Node or React imports, so it runs in the browser and in unit tests):
 * task status, critical path, dependency chains, the timeline grid and the graph layout.
 */
import { addDays } from "./dates.ts";
import { diffDays } from "./pipeline.ts";

export interface WTask {
  id: string; project_id: string | null; title: string; description: string;
  status: "todo" | "doing" | "done"; priority: "low" | "medium" | "high"; due_date: string | null; completed_at: string | null;
}
/** `a` must be finished before `b` can start. */
export interface Dep { a: string; b: string }

export type WStatus = "ready" | "blocked" | "overdue" | "conflict" | "done";
export const STATUS_LABEL: Record<WStatus, string> = { ready: "Ready", blocked: "Blocked", overdue: "Overdue", conflict: "Conflict", done: "Done" };
export const STATUS_SENTENCE: Record<WStatus, string> = {
  ready: "Ready to start", blocked: "Blocked by an unfinished task", overdue: "Overdue", conflict: "Due before something it depends on", done: "Done",
};

export interface Graph {
  byId: Map<string, WTask>;
  /** task id -> ids that must finish first */
  depIn: Map<string, string[]>;
  /** task id -> ids that wait on it */
  depOut: Map<string, string[]>;
}

export function buildGraph(tasks: WTask[], deps: Dep[]): Graph {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depIn = new Map<string, string[]>();
  const depOut = new Map<string, string[]>();
  for (const d of deps) {
    if (!byId.has(d.a) || !byId.has(d.b) || d.a === d.b) continue;
    depIn.set(d.b, [...(depIn.get(d.b) ?? []), d.a]);
    depOut.set(d.a, [...(depOut.get(d.a) ?? []), d.b]);
  }
  return { byId, depIn, depOut };
}

const isDone = (g: Graph, id: string) => g.byId.get(id)?.status === "done";

/** Ready / blocked / overdue / conflict / done, in the order that matters most to the user. */
export function statusOf(g: Graph, id: string, today: string): WStatus {
  const t = g.byId.get(id);
  if (!t || t.status === "done") return "done";
  const ds = g.depIn.get(id) ?? [];
  if (t.due_date && ds.some((d) => !isDone(g, d) && !!g.byId.get(d)?.due_date && g.byId.get(d)!.due_date! > t.due_date!)) return "conflict";
  if (t.due_date && t.due_date < today) return "overdue";
  if (ds.some((d) => !isDone(g, d))) return "blocked";
  return "ready";
}

/** True when making `a` a prerequisite of `b` would create a loop (b is already, directly or not, a prerequisite of a). */
export function wouldCycle(deps: Dep[], a: string, b: string): boolean {
  if (a === b) return true;
  const prereq = new Map<string, string[]>();
  for (const d of deps) prereq.set(d.b, [...(prereq.get(d.b) ?? []), d.a]);
  const seen = new Set<string>();
  const stack = [a];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === b) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(prereq.get(cur) ?? []));
  }
  return false;
}

/** Every id reachable from `start` through `map` (excluding start). */
export function reach(start: string, map: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) for (const n of map.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  return seen;
}

export interface Critical { path: string[]; edges: Set<string>; set: Set<string> }
export const edgeKey = (a: string, b: string) => `${a}>${b}`;

/**
 * The longest chain of unfinished prerequisite tasks (ties: the one that ends later). `path` runs from the last task back to the first.
 * A chain of fewer than two tasks is not a critical path.
 */
export function criticalPath(g: Graph, isLive: (id: string) => boolean = () => true): Critical {
  const due = (id: string) => g.byId.get(id)?.due_date ?? "";
  const live = (id: string) => g.byId.has(id) && !isDone(g, id) && isLive(id);
  const memo = new Map<string, number>();
  const lenOf = (id: string, guard: Set<string>): number => {
    const m = memo.get(id);
    if (m !== undefined) return m;
    if (guard.has(id)) return 1;
    guard.add(id);
    let best = 0;
    for (const d of g.depIn.get(id) ?? []) if (live(d)) best = Math.max(best, lenOf(d, guard));
    guard.delete(id);
    memo.set(id, best + 1);
    return best + 1;
  };
  let bestId: string | null = null;
  for (const t of g.byId.values()) {
    if (!live(t.id)) continue;
    const l = lenOf(t.id, new Set());
    if (bestId === null || l > lenOf(bestId, new Set()) || (l === lenOf(bestId, new Set()) && due(t.id) > due(bestId))) bestId = t.id;
  }
  const none: Critical = { path: [], edges: new Set(), set: new Set() };
  if (!bestId) return none;
  const path = [bestId];
  const edges = new Set<string>();
  let cur = bestId;
  for (let i = 0; i < 200; i++) {
    let next: string | null = null;
    for (const d of g.depIn.get(cur) ?? []) {
      if (!live(d)) continue;
      if (next === null || lenOf(d, new Set()) > lenOf(next, new Set()) || (lenOf(d, new Set()) === lenOf(next, new Set()) && due(d) > due(next))) next = d;
    }
    if (!next) break;
    edges.add(edgeKey(next, cur));
    path.push(next);
    cur = next;
  }
  if (path.length < 2) return none;
  return { path, edges, set: new Set(path) };
}

/* ---------------- timeline grid ---------------- */

export const RANGE_DAYS = { week: 7, "2w": 14, month: 28 } as const;
export type Range = keyof typeof RANGE_DAYS;

export interface TimelineChip { id: string; x: number; y: number; w: number; ix: number }
export interface TimelineLane { projectId: string; y: number; shown: number; later: number; undated: number }
export interface TimelineCol { i: number; date: string; x: number; today: boolean; weekend: boolean; load: number }
export interface TimelineLayout { width: number; height: number; colW: number; narrow: boolean; cols: TimelineCol[]; lanes: TimelineLane[]; chips: TimelineChip[]; pos: Map<string, { x: number; y: number }> }

export const TL = { X0: 24, AXH: 92, ROWH: 48, LANEH: 40, LANEGAP: 12, CHIPW: 290, CHIPH: 36, MIN_H: 520, MIN_COL: 44 } as const;

/**
 * Where everything goes on the day-grid timeline. `width` is the available pixel width; columns share it equally
 * (never narrower than TL.MIN_COL, in which case the caller scrolls sideways).
 */
export function layoutTimeline(opts: {
  tasks: WTask[]; projectIds: string[]; today: string; days: number; width: number; isDone?: (id: string) => boolean;
}): TimelineLayout {
  const { tasks, projectIds, today, days } = opts;
  const colW = Math.max(TL.MIN_COL, Math.floor((opts.width - TL.X0 - 16) / days));
  const width = Math.max(opts.width, TL.X0 + 16 + colW * days);
  const narrow = colW < 50;
  const idxOf = (d: string) => Math.max(0, diffDays(today, d));
  let y: number = TL.AXH;
  const lanes: TimelineLane[] = [];
  const chips: TimelineChip[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  const load = new Map<number, number>();
  for (const pid of projectIds) {
    const mine = tasks.filter((t) => (t.project_id ?? "") === pid);
    const dated = mine.filter((t) => t.due_date);
    const shown = dated.filter((t) => idxOf(t.due_date!) < days);
    lanes.push({ projectId: pid, y, shown: shown.length, later: dated.length - shown.length, undated: mine.length - dated.length });
    y += TL.LANEH;
    for (const t of shown) {
      const ix = idxOf(t.due_date!);
      const x = TL.X0 + ix * colW + 6;
      const cy = y + TL.ROWH / 2;
      pos.set(t.id, { x, y: cy });
      if (t.status !== "done") load.set(ix, (load.get(ix) ?? 0) + 1);
      chips.push({ id: t.id, x, y: cy - TL.CHIPH / 2, w: Math.max(130, Math.min(TL.CHIPW, width - 8 - x)), ix });
      y += TL.ROWH;
    }
    y += TL.LANEGAP;
  }
  const cols: TimelineCol[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const dow = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8))).getDay();
    cols.push({ i, date, x: TL.X0 + i * colW, today: i === 0, weekend: dow === 0 || dow === 6, load: load.get(i) ?? 0 });
  }
  return { width, height: Math.max(y + 8, TL.MIN_H), colW, narrow, cols, lanes, chips, pos };
}

/* ---------------- graph layout ---------------- */

export interface GNode { id: string; kind: "project" | "task" | "note" | "tag" | "capture" }
export interface GEdge { a: string; b: string }

const hash01 = (s: string, salt: number): number => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};

/**
 * Deterministic force-directed layout (same data, same picture): nodes repel, edges pull, a weak gravity keeps things inside.
 * Projects start on an inner ring so each project's tasks gather around it.
 */
export function forceLayout(nodes: GNode[], edges: GEdge[], w: number, h: number, minGap = 38): Map<string, { x: number; y: number }> {
  const pad = 36;
  const cx = w / 2;
  const cy = h / 2;
  const p = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const valid = edges.filter((e) => nodes.some((n) => n.id === e.a) && nodes.some((n) => n.id === e.b));
  const adj = new Map<string, string[]>();
  for (const e of valid) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  const clampX = (x: number) => Math.min(w - pad, Math.max(pad, x));
  const clampY = (y: number) => Math.min(h - pad, Math.max(pad, y));
  // Projects start on a ring; everything else starts close to an already placed neighbour so clusters form from the first step.
  const projects = nodes.filter((n) => n.kind === "project");
  projects.forEach((n, i) => {
    const ang = (i / Math.max(1, projects.length)) * Math.PI * 2 - Math.PI / 2;
    p.set(n.id, { x: cx + Math.cos(ang) * w * 0.28, y: cy + Math.sin(ang) * h * 0.28, vx: 0, vy: 0 });
  });
  const queue = projects.map((n) => n.id);
  for (let qi = 0; qi < queue.length; qi++) {
    for (const nb of adj.get(queue[qi]) ?? []) {
      if (p.has(nb)) continue;
      const base = p.get(queue[qi])!;
      const ang = hash01(nb, 3) * Math.PI * 2;
      const r = 55 + hash01(nb, 4) * 70;
      p.set(nb, { x: clampX(base.x + Math.cos(ang) * r), y: clampY(base.y + Math.sin(ang) * r), vx: 0, vy: 0 });
      queue.push(nb);
    }
  }
  for (const n of nodes) if (!p.has(n.id)) p.set(n.id, { x: pad + hash01(n.id, 1) * (w - 2 * pad), y: pad + hash01(n.id, 2) * (h - 2 * pad), vx: 0, vy: 0 });

  const ids = nodes.map((n) => n.id);
  const k = Math.max(46, Math.sqrt((w * h) / Math.max(8, nodes.length)) * 0.5);
  const ITER = 320;
  const landscape = w >= h;
  const XBIAS = landscape ? 1.7 : 1; // wide labels favour horizontal spreading, but not on a tall phone canvas
  const GRAVITY = landscape ? 0.6 : 0.2;
  for (let it = 0; it < ITER; it++) {
    const temp = (1 - it / ITER) * k * 0.3 + 0.2;
    for (const id of ids) { const n = p.get(id)!; n.vx = 0; n.vy = 0; }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = p.get(ids[i])!;
        const b = p.get(ids[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = hash01(ids[i], j) - 0.5; dy = hash01(ids[j], i) - 0.5; d2 = dx * dx + dy * dy + 0.01; }
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        // Labels are wide and short, so nodes are pushed apart more along x than along y.
        a.vx += (dx / d) * f * XBIAS; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f * XBIAS; b.vy -= (dy / d) * f;
      }
    }
    for (const e of valid) {
      const a = p.get(e.a)!;
      const b = p.get(e.b)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k;
      a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
      b.vx += (dx / d) * f; b.vy += (dy / d) * f;
    }
    for (const id of ids) {
      const n = p.get(id)!;
      n.vx += (cx - n.x) * GRAVITY;
      n.vy += (cy - n.y) * GRAVITY;
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 1;
      const step = Math.min(speed, temp);
      n.x = clampX(n.x + (n.vx / speed) * step);
      n.y = clampY(n.y + (n.vy / speed) * step);
    }
  }
  // Final separation pass: no two node centres closer than `minGap` (a touch target is at most 36px), so touch areas never overlap.
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = p.get(ids[i])!;
        const b = p.get(ids[j])!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d >= minGap) continue;
        if (d < 0.01) { dx = hash01(ids[i], 7) - 0.5; dy = hash01(ids[j], 8) - 0.5; d = Math.sqrt(dx * dx + dy * dy) || 1; }
        const push = (minGap - d) / 2 + 0.5;
        a.x = clampX(a.x - (dx / d) * push); a.y = clampY(a.y - (dy / d) * push);
        b.x = clampX(b.x + (dx / d) * push); b.y = clampY(b.y + (dy / d) * push);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map([...p].map(([id, n]) => [id, { x: Math.round(n.x), y: Math.round(n.y) }]));
}
