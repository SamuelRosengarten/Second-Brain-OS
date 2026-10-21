import { buildGraph, criticalPath, reach, statusOf, STATUS_LABEL, type Critical, type Dep, type Graph, type WStatus, type WTask } from "@/lib/workflow-logic";
import type { WorkflowData } from "@/lib/workflow";

export type Kind = "project" | "task" | "note" | "tag" | "capture";
export interface Entity { id: string; kind: Kind; title: string; color: string }
export interface WProject { id: string; name: string; color: string; open: number }
export type LinkKind = "member" | "dep" | "link" | "sugg";
export interface WLink { a: string; b: string; kind: LinkKind }
export interface Suggestion { id: string; a: string; b: string; conf: number; why: string }

export interface Model {
  today: string;
  projects: WProject[];
  visibleProjects: WProject[];
  tasks: WTask[];
  graph: Graph;
  deps: Dep[];
  status: Map<string, WStatus>;
  crit: Critical;
  critOn: boolean;
  entities: Map<string, Entity>;
  links: WLink[];
  /** pending suggestions shown now (confident ones, or all when showLow) */
  suggestions: Suggestion[];
  lowHidden: number;
  neighbours: Map<string, Set<string>>;
}

export interface ModelInput {
  data: WorkflowData;
  today: string;
  dueOv: Record<string, string | null>;
  doneOv: Record<string, boolean>;
  hidden: Set<string>;
  showLow: boolean;
  crit: boolean;
  showSugg: boolean;
  show: { note: boolean; tag: boolean; capture: boolean };
}

export const LOW_CONFIDENCE = 70;
export const projectColor = (i: number): string => `var(--wf-p${i % 8})`;

export const BADGE: Record<WStatus, { label: string; fg: string; bg: string }> = {
  ready: { label: STATUS_LABEL.ready, fg: "var(--wf-ready)", bg: "var(--wf-ready-bg)" },
  blocked: { label: STATUS_LABEL.blocked, fg: "var(--wf-block)", bg: "var(--wf-block-bg)" },
  overdue: { label: STATUS_LABEL.overdue, fg: "var(--wf-late)", bg: "var(--wf-late-bg)" },
  conflict: { label: STATUS_LABEL.conflict, fg: "var(--wf-late)", bg: "var(--wf-late-bg)" },
  done: { label: STATUS_LABEL.done, fg: "var(--wf-done)", bg: "var(--wf-done-bg)" },
};

/** `color` blended with transparency: the design's "colour + 1c" tints, but working with CSS variables. */
export const tint = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parts = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1, day: Number(d.slice(8, 10)) });
export const dowOf = (d: string): number => { const p = parts(d); return new Date(p.y, p.m, p.day).getDay(); };
export const shortDate = (d: string): string => `${MON[parts(d).m]} ${parts(d).day}`;
export const fmtDay = (d: string): string => `${DOW[dowOf(d)]}, ${MON[parts(d).m]} ${parts(d).day}`;
export const DOW_NAMES = DOW;
export const MONTHS = MON;

export function buildModel(i: ModelInput): Model {
  const { data, today } = i;
  const projects: WProject[] = data.projects.map((p, idx) => ({ id: p.id, name: p.name, color: projectColor(idx), open: p.open_tasks }));
  // Tasks with no project get a pseudo project so they appear in lanes, filters and the agenda like any other.
  const loose = data.tasks.filter((t) => !t.project_id && !(Object.prototype.hasOwnProperty.call(i.doneOv, t.id) ? i.doneOv[t.id] : t.status === "done")).length;
  if (data.tasks.some((t) => !t.project_id)) projects.push({ id: "", name: "No project", color: "var(--wf-note)", open: loose });
  const visibleProjects = projects.filter((p) => !i.hidden.has(p.id));
  const projIndex = new Map(projects.map((p) => [p.id, p]));

  // Apply the user's pending local changes (drags, done toggles) on top of the server data.
  const tasks: WTask[] = data.tasks.map((t) => {
    const due = Object.prototype.hasOwnProperty.call(i.dueOv, t.id) ? i.dueOv[t.id] : t.due_date;
    const done = Object.prototype.hasOwnProperty.call(i.doneOv, t.id) ? i.doneOv[t.id] : t.status === "done";
    return { id: t.id, project_id: t.project_id, title: t.title, description: t.description, priority: t.priority, due_date: due, completed_at: t.completed_at, status: done ? "done" : t.status === "done" ? "todo" : t.status };
  });

  const deps: Dep[] = data.deps;
  const suggAll = data.suggestions.map<Suggestion>((s) => ({ id: s.id, a: s.a, b: s.b, conf: s.confidence, why: s.why }));
  const suggestions = suggAll.filter((s) => s.conf >= LOW_CONFIDENCE || i.showLow);
  const lowHidden = suggAll.length - suggestions.length;
  const graph = buildGraph(tasks, deps);
  const status = new Map<string, WStatus>();
  for (const t of tasks) status.set(t.id, statusOf(graph, t.id, today));

  const visibleIds = new Set(visibleProjects.map((p) => p.id));
  const critAll = criticalPath(graph, (id) => visibleIds.has(graph.byId.get(id)?.project_id ?? ""));
  const critOn = i.crit && critAll.path.length > 1;

  const entities = new Map<string, Entity>();
  for (const p of projects) if (p.id) entities.set(p.id, { id: p.id, kind: "project", title: p.name, color: p.color });
  for (const t of tasks) entities.set(t.id, { id: t.id, kind: "task", title: t.title, color: projIndex.get(t.project_id ?? "")?.color ?? "var(--wf-note)" });
  for (const n of data.notes) entities.set(n.id, { id: n.id, kind: "note", title: n.title, color: "var(--wf-note)" });
  for (const n of data.tags) entities.set(n.id, { id: n.id, kind: "tag", title: n.title, color: "var(--wf-tag)" });
  for (const n of data.captures) entities.set(n.id, { id: n.id, kind: "capture", title: n.title, color: "var(--wf-cap)" });

  const links: WLink[] = [];
  for (const t of tasks) if (t.project_id && projIndex.has(t.project_id)) links.push({ a: t.id, b: t.project_id, kind: "member" });
  for (const d of deps) links.push({ a: d.a, b: d.b, kind: "dep" });
  for (const l of data.links) if (entities.has(l.a) && entities.has(l.b)) links.push({ a: l.a, b: l.b, kind: "link" });
  if (i.showSugg) for (const s of suggestions) links.push({ a: s.a, b: s.b, kind: "sugg" });

  const neighbours = new Map<string, Set<string>>();
  for (const l of links) {
    (neighbours.get(l.a) ?? neighbours.set(l.a, new Set()).get(l.a)!).add(l.b);
    (neighbours.get(l.b) ?? neighbours.set(l.b, new Set()).get(l.b)!).add(l.a);
  }
  return { today, projects, visibleProjects, tasks, graph, deps, status, crit: critAll, critOn, entities, links, suggestions, lowHidden, neighbours };
}

/** What lights up when `focus` is hovered or pinned: a task's whole dependency chain plus direct neighbours; everything else dims. */
export function focusSets(m: Model, focus: string | null): { chain: Set<string>; lit: Set<string> } | null {
  if (!focus || !m.entities.has(focus)) return null;
  const chain = new Set<string>([focus]);
  if (m.entities.get(focus)!.kind === "task") {
    for (const x of reach(focus, m.graph.depIn)) chain.add(x);
    for (const x of reach(focus, m.graph.depOut)) chain.add(x);
  }
  const lit = new Set(chain);
  for (const x of m.neighbours.get(focus) ?? []) lit.add(x);
  return { chain, lit };
}
