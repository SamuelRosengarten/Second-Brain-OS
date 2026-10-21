"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { STATUS_SENTENCE, wouldCycle } from "@/lib/workflow-logic";
import { fmtDay, type Model } from "./model";

interface Group { label: string; ids: string[]; empty: string; removable?: boolean }

export interface InspectorProps {
  model: Model;
  /** the hovered or pinned item */
  id: string | null;
  pinned: boolean;
  preview: boolean;
  onJump: (id: string) => void;
  onToggleDone: (id: string) => void;
  onEdit: (id: string) => void;
  onAddDep: (taskId: string, dependsOn: string) => void;
  onRemoveDep: (taskId: string, dependsOn: string) => void;
  /** true on phones, where tapping (not hovering) is how you inspect */
  touch: boolean;
}

const label = "text-[11px] font-medium tracking-[0.08em] uppercase text-[var(--wf-muted)]";

export function Inspector(p: InspectorProps) {
  const m = p.model;
  const e = p.id ? m.entities.get(p.id) : undefined;
  const [pick, setPick] = useState("");
  if (!p.id || !e) {
    return <p className="self-center text-sm text-[var(--wf-muted)]">{p.touch ? "Tap a task, project, note, tag or capture to see how it connects." : "Hover a task, project, note, tag or capture to preview how it connects. Click to pin it."}</p>;
  }
  const id = p.id;
  const linked = (x: string) => m.links.filter((l) => l.kind === "link" && (l.a === x || l.b === x)).map((l) => (l.a === x ? l.b : l.a));
  const groups: Group[] = [];
  let meta = "";
  let canDone = false;
  let canEdit = false;
  let addable: { id: string; title: string }[] = [];
  if (e.kind === "task") {
    const t = m.graph.byId.get(id)!;
    const st = m.status.get(id)!;
    const proj = m.projects.find((x) => x.id === t.project_id);
    meta = `${STATUS_SENTENCE[st]} · ${t.due_date ? `Due ${fmtDay(t.due_date)}` : "No due date"}${proj ? ` · ${proj.name}` : ""}`;
    canDone = p.pinned;
    canEdit = p.pinned;
    groups.push({ label: "Depends on", ids: m.graph.depIn.get(id) ?? [], empty: "Nothing, ready to start", removable: p.pinned });
    groups.push({ label: "Unblocks", ids: m.graph.depOut.get(id) ?? [], empty: "Nothing is waiting on this" });
    const pend = m.suggestions.filter((g) => g.a === id || g.b === id).map((g) => (g.a === id ? g.b : g.a));
    if (pend.length) groups.push({ label: "AI suggests linking", ids: pend, empty: "" });
    const lk = linked(id);
    if (lk.length) groups.push({ label: "Mentions and tags", ids: lk, empty: "" });
    if (p.pinned) {
      addable = m.tasks
        .filter((x) => x.id !== id && x.status !== "done" && !(m.graph.depIn.get(id) ?? []).includes(x.id) && !wouldCycle(m.deps, x.id, id))
        .map((x) => ({ id: x.id, title: x.title }));
    }
  } else if (e.kind === "project") {
    const open = m.projects.find((x) => x.id === id)?.open ?? 0;
    meta = `${open} open tasks`;
    groups.push({ label: "Tasks with a due date", ids: m.tasks.filter((x) => x.project_id === id && x.due_date).map((x) => x.id), empty: "None yet" });
    const lk = linked(id);
    if (lk.length) groups.push({ label: "Mentioned by", ids: lk, empty: "" });
  } else {
    meta = e.kind === "note" ? "Note" : e.kind === "tag" ? "Tag" : "Capture";
    groups.push({ label: "Linked to", ids: linked(id), empty: "Not linked to anything yet" });
  }
  const kindLabel = `${e.kind}${p.preview ? " · preview, click to pin" : p.pinned ? " · pinned" : ""}`;
  const doneNow = m.graph.byId.get(id)?.status === "done";

  return (
    <>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
        <span className={label}>{kindLabel}</span>
        <h2 className="m-0 text-base leading-snug font-semibold text-[var(--wf-strong)]">{e.title}</h2>
        <span className="text-[13px] text-[var(--wf-muted)]">{meta}</span>
        {(canDone || canEdit) && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {canDone && <button type="button" onClick={() => p.onToggleDone(id)} className="h-10 rounded-lg border border-[var(--wf-btnline)] bg-[var(--wf-btn)] px-3.5 text-[13px] font-medium text-[var(--wf-strong)]">{doneNow ? "Mark as not done" : "Mark as done"}</button>}
            {canEdit && <button type="button" onClick={() => p.onEdit(id)} className="h-10 rounded-lg border border-[var(--wf-btnline)] bg-transparent px-3.5 text-[13px] text-[var(--wf-soft)]">Edit details</button>}
          </div>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.label} className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
          <span className={label}>{g.label}</span>
          {g.ids.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {g.ids.map((x) => {
                const ent = m.entities.get(x);
                if (!ent) return null;
                return (
                  <span key={x} className="inline-flex max-w-full items-center rounded-lg border border-[var(--wf-btnline)] bg-[var(--wf-btn)]">
                    <button type="button" onClick={() => p.onJump(x)} className="flex h-10 min-w-0 items-center gap-2 rounded-lg bg-transparent px-3 text-left text-[13px] text-[var(--wf-text)]">
                      <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: ent.color }} />
                      <span className="max-w-[16rem] min-w-0 truncate">{ent.title}</span>
                    </button>
                    {g.removable && (
                      <button type="button" aria-label={`Remove dependency on ${ent.title}`} onClick={() => p.onRemoveDep(id, x)} className="grid h-10 w-9 flex-none place-items-center text-[var(--wf-muted)] hover:text-[var(--wf-bad)]">
                        <X size={14} aria-hidden />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="text-[13px] text-[var(--wf-muted)]">{g.empty}</span>
          )}
          {g.label === "Depends on" && p.pinned && addable.length > 0 && (
            <div className="flex gap-2">
              <select aria-label="Add a dependency" value={pick} onChange={(ev) => setPick(ev.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--wf-btnline)] bg-[var(--wf-btn)] px-2 text-[13px] text-[var(--wf-text)]">
                <option value="">Must wait for…</option>
                {addable.map((a) => <option key={a.id} value={a.id}>{a.title.length > 60 ? `${a.title.slice(0, 59)}…` : a.title}</option>)}
              </select>
              <button type="button" disabled={!pick} onClick={() => { p.onAddDep(id, pick); setPick(""); }} className="h-10 rounded-lg border px-3.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: "var(--wf-primary)", color: "#ffffff", borderColor: "transparent" }}>Add</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
