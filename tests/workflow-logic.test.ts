import { describe, expect, it } from "vitest";
import { buildGraph, criticalPath, forceLayout, layoutTimeline, reach, statusOf, wouldCycle, type Dep, type GEdge, type GNode, type WTask } from "../src/lib/workflow-logic.ts";

const today = "2026-10-21";
const T = (id: string, due: string | null, o: Partial<WTask> = {}): WTask => ({ id, project_id: "p", title: id, description: "", status: "todo", priority: "medium", due_date: due, completed_at: null, ...o });
const D = (a: string, b: string): Dep => ({ a, b });

describe("status", () => {
  it("is ready, blocked, overdue, conflict or done", () => {
    const tasks = [T("a", "2026-10-25"), T("b", "2026-10-28"), T("c", "2026-10-22"), T("late", "2026-10-10"), T("fin", "2026-10-25", { status: "done" }), T("free", null)];
    const g = buildGraph(tasks, [D("a", "b"), D("b", "c"), D("fin", "free")]);
    expect(statusOf(g, "a", today)).toBe("ready");
    expect(statusOf(g, "b", today)).toBe("blocked");
    expect(statusOf(g, "c", today)).toBe("conflict"); // c is due 22nd but waits for b due 28th
    expect(statusOf(g, "late", today)).toBe("overdue");
    expect(statusOf(g, "fin", today)).toBe("done");
    expect(statusOf(g, "free", today)).toBe("ready"); // its only prerequisite is finished
  });
  it("stops being blocked once the prerequisite is done, and ignores undated tasks for conflicts", () => {
    const tasks = [T("a", "2026-10-25", { status: "done" }), T("b", "2026-10-26"), T("x", null), T("y", "2026-10-26")];
    const g = buildGraph(tasks, [D("a", "b"), D("x", "y")]);
    expect(statusOf(g, "b", today)).toBe("ready");
    expect(statusOf(g, "y", today)).toBe("blocked");
  });
});

describe("dependencies", () => {
  it("detects loops before they are created", () => {
    const deps = [D("a", "b"), D("b", "c")];
    expect(wouldCycle(deps, "c", "a")).toBe(true); // c before a, but a already leads to c
    expect(wouldCycle(deps, "a", "c")).toBe(false); // already implied, no loop
    expect(wouldCycle(deps, "x", "a")).toBe(false);
    expect(wouldCycle(deps, "a", "a")).toBe(true);
  });
  it("walks chains in both directions", () => {
    const g = buildGraph([T("a", null), T("b", null), T("c", null), T("z", null)], [D("a", "b"), D("b", "c")]);
    expect([...reach("c", g.depIn)].sort()).toEqual(["a", "b"]);
    expect([...reach("a", g.depOut)].sort()).toEqual(["b", "c"]);
    expect(reach("z", g.depOut).size).toBe(0);
  });
  it("ignores dependencies that point at unknown tasks", () => {
    const g = buildGraph([T("a", null)], [D("a", "ghost"), D("ghost", "a")]);
    expect(g.depIn.size).toBe(0);
  });
});

describe("critical path", () => {
  it("is the longest chain of unfinished tasks and runs from the last task back", () => {
    const tasks = [T("a", "2026-10-22"), T("b", "2026-10-24"), T("c", "2026-10-27"), T("s1", "2026-10-30"), T("s2", "2026-10-30")];
    const g = buildGraph(tasks, [D("a", "b"), D("b", "c"), D("s1", "s2")]);
    const c = criticalPath(g);
    expect(c.path).toEqual(["c", "b", "a"]);
    expect([...c.edges].sort()).toEqual(["a>b", "b>c"]);
  });
  it("skips finished tasks and hidden projects, and needs at least two tasks", () => {
    const tasks = [T("a", "2026-10-22", { status: "done" }), T("b", "2026-10-24"), T("c", "2026-10-27")];
    const g = buildGraph(tasks, [D("a", "b"), D("b", "c")]);
    expect(criticalPath(g).path).toEqual(["c", "b"]);
    expect(criticalPath(g, (id) => id !== "b").path).toEqual([]);
    expect(criticalPath(buildGraph([T("solo", "2026-10-22")], [])).path).toEqual([]);
  });
  it("survives a loop in bad data", () => {
    const g = buildGraph([T("a", "2026-10-22"), T("b", "2026-10-23")], [D("a", "b"), D("b", "a")]);
    expect(() => criticalPath(g)).not.toThrow();
  });
});

describe("timeline layout", () => {
  it("places chips on their due day, counts load per day and reports what is out of range or undated", () => {
    const tasks = [T("a", "2026-10-21"), T("b", "2026-10-21"), T("c", "2026-10-24"), T("far", "2026-12-01"), T("nodate", null), T("done", "2026-10-22", { status: "done" }), T("o", "2026-10-01", { project_id: "q" })];
    const l = layoutTimeline({ tasks, projectIds: ["p", "q"], today, days: 14, width: 1096 });
    expect(l.colW).toBe(Math.floor((1096 - 24 - 16) / 14));
    expect(l.cols).toHaveLength(14);
    expect(l.cols[0]).toMatchObject({ today: true, load: 3 }); // a, b and the overdue task (clamped to today)
    expect(l.cols[3].load).toBe(1);
    expect(l.cols[1].load).toBe(0); // finished tasks do not count as load
    expect(l.lanes[0]).toMatchObject({ projectId: "p", later: 1, undated: 1, shown: 4 });
    const a = l.chips.find((c) => c.id === "a")!;
    const c = l.chips.find((c) => c.id === "c")!;
    expect(c.x - a.x).toBe(3 * l.colW);
    expect(l.chips.find((x) => x.id === "o")!.ix).toBe(0); // overdue tasks sit in the first column
    expect(l.height).toBeGreaterThanOrEqual(520);
    const ys = l.chips.map((x) => x.y);
    expect(new Set(ys).size).toBe(ys.length); // one row per chip, nothing stacked
  });
  it("switches to narrow columns and widens the canvas when the screen is small", () => {
    const l = layoutTimeline({ tasks: [], projectIds: ["p"], today, days: 28, width: 400 });
    expect(l.colW).toBe(44);
    expect(l.narrow).toBe(true);
    expect(l.width).toBe(24 + 16 + 44 * 28);
  });
});

describe("graph layout", () => {
  const nodes: GNode[] = [
    ...["p1", "p2", "p3"].map((id) => ({ id, kind: "project" as const })),
    ...Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, kind: "task" as const })),
    { id: "n1", kind: "note" }, { id: "tg1", kind: "tag" }, { id: "c1", kind: "capture" },
  ];
  const edges: GEdge[] = [...Array.from({ length: 24 }, (_, i) => ({ a: `t${i}`, b: `p${(i % 3) + 1}` })), { a: "n1", b: "p1" }, { a: "tg1", b: "n1" }, { a: "c1", b: "t0" }];
  it("is deterministic, keeps every node inside the canvas and keeps touch targets apart", () => {
    const a = forceLayout(nodes, edges, 900, 620);
    const b = forceLayout(nodes, edges, 900, 620);
    expect([...a]).toEqual([...b]);
    for (const [, p] of a) { expect(p.x).toBeGreaterThanOrEqual(36); expect(p.x).toBeLessThanOrEqual(864); expect(p.y).toBeGreaterThanOrEqual(36); expect(p.y).toBeLessThanOrEqual(584); }
    const pts = [...a.values()];
    let tooClose = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 37) tooClose++;
    expect(tooClose).toBe(0);
  });
  it("pulls a project's tasks nearer to it than to another project", () => {
    const l = forceLayout(nodes, edges, 900, 620);
    let nearer = 0;
    for (let i = 0; i < 24; i++) {
      const t = l.get(`t${i}`)!;
      const own = l.get(`p${(i % 3) + 1}`)!;
      const others = ["p1", "p2", "p3"].filter((p) => p !== `p${(i % 3) + 1}`).map((p) => l.get(p)!);
      if (Math.hypot(t.x - own.x, t.y - own.y) <= Math.min(...others.map((o) => Math.hypot(t.x - o.x, t.y - o.y)))) nearer++;
    }
    expect(nearer).toBeGreaterThanOrEqual(18);
  });
  it("handles empty and single-node graphs", () => {
    expect(forceLayout([], [], 400, 300).size).toBe(0);
    expect(forceLayout([{ id: "x", kind: "task" }], [], 400, 300).size).toBe(1);
  });
});

describe("graph layout on a phone-sized canvas", () => {
  it("keeps node centres at least 38px apart even when the graph is dense", () => {
    const nodes: GNode[] = [
      ...["p1", "p2", "p3", "p4"].map((id) => ({ id, kind: "project" as const })),
      ...Array.from({ length: 45 }, (_, i) => ({ id: `t${i}`, kind: "task" as const })),
      ...Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, kind: "note" as const })),
    ];
    const edges: GEdge[] = [...Array.from({ length: 45 }, (_, i) => ({ a: `t${i}`, b: `p${(i % 4) + 1}` })), ...Array.from({ length: 8 }, (_, i) => ({ a: `n${i}`, b: `p${(i % 4) + 1}` }))];
    const l = forceLayout(nodes, edges, 358, 1200);
    const pts = [...l.values()];
    let worst = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) worst = Math.min(worst, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    expect(worst).toBeGreaterThanOrEqual(37); // 38 minus rounding
    for (const p of pts) { expect(p.x).toBeGreaterThanOrEqual(36); expect(p.x).toBeLessThanOrEqual(322); }
  });
});
