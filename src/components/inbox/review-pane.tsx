"use client";
import Link from "next/link";
import { Archive, ChevronDown, ChevronUp, MoreHorizontal, Paperclip, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ProjectSquare, useProjects } from "../blocks";
import { api } from "../client";
import { ConfirmDialog, ErrorBox, Loading, useToast } from "../ui";
import { titleOf, useCaptureDraft } from "./use-draft";
import { dowDay } from "@/lib/dates";
import type { Capture } from "@/lib/captures";

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const label = "text-xs text-muted";
const input = "w-full rounded-[9px] border border-line bg-surface px-3 text-fg placeholder:text-faint focus:border-accent";

/** Tag chips you can remove, plus an "Add tag" field. */
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState("");
  const commit = () => {
    const t = v.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setV("");
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="flex h-7 items-center gap-1.5 rounded-[7px] bg-surface2 pr-1 pl-2.5 font-mono text-[11.5px]">
          #{t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="grid size-6 place-items-center rounded text-faint hover:text-fg"><X size={12} aria-hidden /></button>
        </span>
      ))}
      {adding ? (
        <input autoFocus aria-label="New tag" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setV(""); setAdding(false); } }} className="h-7 w-28 rounded-[7px] border border-line2 bg-surface px-2 font-mono text-xs text-fg" />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="h-7 rounded-[7px] border border-dashed border-line2 px-2.5 text-xs text-muted hover:text-fg">Add tag</button>
      )}
    </div>
  );
}

export function ReviewPane({ id, position, onPrev, onNext, onResolved, onChanged }: {
  id: string; position?: { index: number; total: number }; onPrev?: () => void; onNext?: () => void; onResolved: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const { projects, colorOf } = useProjects();
  const live = projects.filter((p) => p.status !== "archived");
  const d = useCaptureDraft(id, live, onChanged);
  const { capture: c, draft, setDraft } = d;
  const uid = useId();
  const [editingOriginal, setEditingOriginal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setEditingOriginal(false); setMenu(false); }, [id]);

  const ticked = draft?.tasks.filter((t) => t.checked && t.title.trim()).length ?? 0;
  const canAccept = !!c && !!draft && ["proposed", "new", "failed", "dismissed"].includes(c.status) && !d.busy;
  const reviewable = c?.status === "proposed";

  async function accept(mode: "full" | "plain") {
    const r = await d.accept(mode);
    if (!r) return;
    toast(`Saved “${draft?.title.trim() || titleOf(c!)}”${r.tasks ? ` and ${r.tasks} ${r.tasks === 1 ? "task" : "tasks"}` : ""}`, "ok", { label: "Open note", onClick: () => { window.location.href = `/knowledge/${r.noteId}`; } });
    onResolved();
  }
  async function dismiss() {
    if (await d.dismiss()) { toast("Dismissed", "ok"); onResolved(); }
  }

  // A accept, D dismiss, J/K move; ignored while typing or when a dialog is open.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) || document.querySelector("dialog[open]")) return;
      const k = e.key.toLowerCase();
      if (k === "a" && reviewable && canAccept) { e.preventDefault(); void accept("full"); }
      else if (k === "d" && (reviewable || c?.status === "new")) { e.preventDefault(); void dismiss(); }
      else if (k === "j") onNext?.();
      else if (k === "k") onPrev?.();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (d.error) return <ErrorBox message={d.error} onRetry={() => void d.reload()} />;
  if (!c || !draft) return <Loading />;
  const patch = async (body: object, ok: string) => { await d.run("patch", () => api(`/api/captures/${c.id}`, { method: "PATCH", body })); toast(ok, "ok"); await d.reload(); onChanged(); };

  return (
    <section aria-label="Review capture" className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-xs text-faint">{position ? `REVIEW ${position.index} OF ${position.total}` : "CAPTURE"}</span>
        {position && (
          <div className="flex gap-1">
            <button type="button" aria-label="Previous capture" onClick={onPrev} disabled={!onPrev} className="grid size-[30px] place-items-center rounded-lg border border-line text-muted hover:bg-hover disabled:opacity-40"><ChevronUp size={14} aria-hidden strokeWidth={2} /></button>
            <button type="button" aria-label="Next capture" onClick={onNext} disabled={!onNext} className="grid size-[30px] place-items-center rounded-lg border border-line text-muted hover:bg-hover disabled:opacity-40"><ChevronDown size={14} aria-hidden strokeWidth={2} /></button>
          </div>
        )}
        <span className="ml-auto hidden font-mono text-[11.5px] text-faint xl:inline">A accept · D dismiss · J/K move</span>
      </div>

      {c.status === "failed" && <ErrorBox message="AI processing failed. Your original capture is safe." hint={c.error ?? undefined} onRetry={() => void d.processAgain()} />}
      {c.status === "processing" && <div role="status" className="flex items-center gap-2.5 rounded-xl border border-warn/35 bg-warn/10 px-3.5 py-2.5 text-[13px]"><Sparkles size={15} aria-hidden className="animate-pulse text-warn" />Your local model is working on this. The first reply after idle can take up to a minute while the model loads.</div>}
      {c.status === "accepted" && c.note_id && <div className="flex items-center gap-2 rounded-xl border border-ok/35 bg-ok/10 px-3.5 py-2.5 text-[13px]">Saved as a note. <Link href={`/knowledge/${c.note_id}`} className="font-medium text-accent underline">Open note</Link></div>}

      <div className="flex flex-wrap items-start gap-5">
        {/* ---------- what you captured ---------- */}
        <section aria-labelledby={`${uid}-raw`} className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5">
          <h2 id={`${uid}-raw`} className="m-0 text-[12.5px] font-semibold text-muted">You captured</h2>
          <div className="flex flex-col gap-3.5 rounded-xl border border-line bg-surface p-[18px]">
            {editingOriginal ? (
              <>
                <label htmlFor={`${uid}-orig`} className="sr-only">Capture text</label>
                <textarea id={`${uid}-orig`} rows={8} value={d.content} onChange={(e) => d.setContent(e.target.value)} className={`${input} py-2.5 text-[15px] leading-relaxed`} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { void d.saveOriginal(); setEditingOriginal(false); }} className="h-9 rounded-[9px] bg-primary px-3.5 text-[13px] font-semibold text-primary-fg">Save edit</button>
                  <button type="button" onClick={() => { d.setContent(c.content); setEditingOriginal(false); }} className="h-9 rounded-[9px] px-3 text-[13px] text-muted hover:bg-hover">Cancel</button>
                </div>
              </>
            ) : (
              <p className="m-0 text-[15px] leading-[1.6] text-pretty whitespace-pre-wrap">{c.content}</p>
            )}
            {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[13px] break-all text-accent underline">{c.url}</a>}
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 font-mono text-[11px] text-faint"><span>{c.kind === "link" ? "Link" : c.kind === "task" ? "Task" : "Note"}</span><span>{when(c.created_at)}</span><span>{wordCount(c.content)} words</span></div>
            {c.attachments.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {c.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2.5 text-[13px]">
                    {a.mime.startsWith("image/") ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/attachments/${a.id}?inline=1`} alt={a.filename} className="size-12 rounded-md border border-line object-cover" /> : <Paperclip size={14} aria-hidden className="text-faint" />}
                    <a href={`/api/attachments/${a.id}`} className="text-accent underline">{a.filename}</a>
                    <span className="font-mono text-[11px] text-faint">{(a.size / 1024).toFixed(0)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {c.status !== "accepted" && !editingOriginal && <button type="button" onClick={() => setEditingOriginal(true)} className="h-8 self-start rounded-lg px-2.5 text-[12.5px] text-muted hover:text-fg">Edit the original</button>}
          {d.content !== c.original_content && <p className="m-0 text-xs text-faint">Edited. The untouched original is kept separately.</p>}
        </section>

        {/* ---------- what the local model proposes ---------- */}
        {c.status !== "accepted" && (
          <section aria-labelledby={`${uid}-prop`} className="flex min-w-0 flex-[1.4_1_380px] flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Sparkles size={14} aria-hidden strokeWidth={1.8} className="text-accent" />
              <h2 id={`${uid}-prop`} className="m-0 text-[12.5px] font-semibold text-accent">{c.proposal ? `Proposed by ${c.model ?? "your local model"}` : "Save as a note"}</h2>
              <span className="ml-auto text-xs text-faint">Edit anything before you accept</span>
            </div>
            {c.proposal ? (
              <div className="flex flex-col gap-4 rounded-xl border border-dashed border-ai-line bg-ai-soft p-[18px]">
                <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-t`} className={label}>Title</label><input id={`${uid}-t`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${input} h-10 text-[15px] font-medium`} /></div>
                <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-s`} className={label}>Summary</label><textarea id={`${uid}-s`} rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className={`${input} resize-none py-2.5 text-[13.5px] leading-[1.55]`} /></div>
                <div className="flex flex-wrap gap-4">
                  <div className="flex min-w-48 flex-[1_1_200px] flex-col gap-1.5"><span className={label}>Tags</span><TagEditor tags={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} /></div>
                  <div className="flex min-w-44 flex-[1_1_180px] flex-col gap-1.5">
                    <label htmlFor={`${uid}-p`} className={label}>Project</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"><ProjectSquare color={draft.projectId ? colorOf(draft.projectId) : "var(--faint)"} /></span>
                      <select id={`${uid}-p`} value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })} className={`${input} h-9 appearance-none pl-8 text-[13px]`}>
                        <option value="">No project</option>
                        {live.map((p) => <option key={p.id} value={p.id}>{p.name}{c.proposal?.related_projects.includes(p.name) ? " (suggested)" : ""}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                {(draft.tasks.length > 0 || draft.related) && (
                  <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                    <legend className="pb-1.5 text-xs text-muted">Also create</legend>
                    {draft.tasks.map((t, i) => (
                      <div key={t.key} className="flex min-h-10 items-center gap-2.5 rounded-[9px] bg-surface px-3 text-[13px]">
                        <input type="checkbox" aria-label={`Create task: ${t.title}`} checked={t.checked} onChange={(e) => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)) })} className="size-4 accent-[var(--accent)]" />
                        <input aria-label={`Task ${i + 1} title`} value={t.title} onChange={(e) => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-fg" />
                        <span className="relative w-[4.5rem] shrink-0 text-right">
                          <span aria-hidden className="font-mono text-[11px] text-faint">{t.due ? dowDay(t.due) : "no date"}</span>
                          <input aria-label={`Due date of task ${i + 1}`} type="date" value={t.due} onChange={(e) => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)) })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                        </span>
                      </div>
                    ))}
                    {draft.related && (
                      <label className="flex min-h-10 items-center gap-2.5 rounded-[9px] bg-surface px-3 text-[13px]">
                        <input type="checkbox" checked={draft.linkRelated} onChange={(e) => setDraft({ ...draft, linkRelated: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                        <span className="min-w-0 flex-1 truncate">Link to the note “{draft.related.title}”</span>
                        <span className="font-mono text-[11px] text-faint">similar</span>
                      </label>
                    )}
                  </fieldset>
                )}
                <details className="text-[13px]">
                  <summary className="cursor-pointer text-muted">More: category, full note text, open questions</summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-c`} className={label}>Category</label><input id={`${uid}-c`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={`${input} h-9`} /></div>
                    <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-b`} className={label}>Note body (Markdown)</label><textarea id={`${uid}-b`} rows={8} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`${input} py-2.5 font-mono text-[12.5px] leading-6`} /></div>
                    {c.proposal.open_questions.length > 0 && <div><p className="m-0 font-medium">Open questions</p><ul className="mt-1 list-disc pl-5 text-muted">{c.proposal.open_questions.map((q) => <li key={q}>{q}</li>)}</ul></div>}
                    {c.proposal.uncertainty && <p className="m-0 rounded-lg bg-warn/10 px-3 py-2"><strong className="font-medium">Uncertainty: </strong>{c.proposal.uncertainty}</p>}
                    <p className="m-0 text-xs text-faint">Model confidence: {c.proposal.confidence}. It is a suggestion from a local model and can be wrong.</p>
                  </div>
                </details>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-[18px]">
                <p className="m-0 text-[13px] text-muted">{c.status === "processing" ? "Your local model is drafting a title, tags and tasks." : "No AI suggestion yet. Process it with your local model, or save it as a plain note."}</p>
                {(c.status === "new" || c.status === "dismissed" || c.status === "failed") && (
                  <button type="button" onClick={() => void d.processAgain()} disabled={!!d.busy} className="flex h-10 items-center justify-center gap-2 self-start rounded-[9px] bg-primary px-4 text-[13.5px] font-semibold text-primary-fg disabled:opacity-50"><Sparkles size={14} aria-hidden />Process with local AI</button>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {c.status !== "accepted" && (
        <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3.5">
          {reviewable && (
            <button type="button" onClick={() => void accept("full")} disabled={!canAccept || !draft.title.trim()} className="flex h-10 items-center gap-2 rounded-[9px] bg-primary px-4 text-[13.5px] font-semibold text-primary-fg hover:bg-primary-hover disabled:opacity-50">
              Accept: save note{ticked ? ` + ${ticked} ${ticked === 1 ? "task" : "tasks"}` : ""}<span aria-hidden className="font-mono text-[11px] opacity-65">A</span>
            </button>
          )}
          <button type="button" onClick={() => void accept("plain")} disabled={!canAccept} className="h-10 rounded-[9px] border border-line px-3.5 text-[13.5px] text-fg hover:bg-hover disabled:opacity-50">Save as plain note</button>
          {(reviewable || c.status === "new") && <button type="button" onClick={() => void dismiss()} disabled={!!d.busy} className="flex h-10 items-center gap-2 rounded-[9px] border border-line px-3.5 text-[13.5px] text-muted hover:bg-hover disabled:opacity-50">Dismiss<span aria-hidden className="font-mono text-[11px] opacity-70">D</span></button>}
          <div className="ml-auto flex items-center gap-1">
            {reviewable && <button type="button" onClick={() => void d.processAgain()} disabled={!!d.busy} className="flex h-10 items-center gap-2 rounded-[9px] px-3 text-[13px] font-medium text-accent hover:bg-ai-bg disabled:opacity-50"><RotateCcw size={14} aria-hidden strokeWidth={2} />Ask again</button>}
            <div className="relative">
              <button type="button" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="grid size-10 place-items-center rounded-[9px] text-muted hover:bg-hover"><MoreHorizontal size={16} aria-hidden /></button>
              {menu && (
                <div role="menu" className="absolute right-0 bottom-11 z-20 flex w-44 flex-col rounded-xl border border-line bg-surface2 p-1 shadow-2xl">
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); void patch({ archived: !c.archived }, c.archived ? "Restored to the inbox" : "Archived"); }} className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] hover:bg-hover"><Archive size={14} aria-hidden />{c.archived ? "Unarchive" : "Archive"}</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setConfirmDelete(true); }} className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] text-danger hover:bg-hover"><Trash2 size={14} aria-hidden />Delete…</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this capture?"
        message="The capture and its processing history will be removed. Attached files are moved to attachments/.trash on disk. Notes already created from it are kept."
        busy={d.busy === "delete"}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const r = await d.run("delete", () => api(`/api/captures/${c.id}`, { method: "DELETE" }));
          setConfirmDelete(false);
          if (r !== undefined) { toast("Capture deleted", "ok"); onResolved(); }
        }}
      />
    </section>
  );
}
