"use client";
import Link from "next/link";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProjectSquare, useProjects } from "../blocks";
import { Loading, useToast } from "../ui";
import { useInbox } from "./inbox-context";
import { titleOf, useCaptureDraft } from "./use-draft";

/**
 * Phone review: one capture at a time, big buttons, and a swipe right to accept or left to dismiss.
 * The queue is fixed when the screen opens, so accepting one never reshuffles the rest.
 */
export function ReviewFlow() {
  const toast = useToast();
  const ib = useInbox();
  const { projects, colorOf } = useProjects();
  const live = projects.filter((p) => p.status !== "archived");
  const [queue, setQueue] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [saved, setSaved] = useState(0);
  const [dismissed, setDismissed] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (ib.loaded && queue === null) setQueue(ib.captures.filter((c) => c.status === "proposed").map((c) => c.id)); }, [ib.loaded, ib.captures, queue]);
  const id = queue?.[i] ?? null;
  const d = useCaptureDraft(id, live, () => void ib.reload());
  const { capture: c, draft, setDraft } = d;
  useEffect(() => setEditing(false), [id]);

  const total = queue?.length ?? 0;
  const next = () => setI((n) => n + 1);
  const ticked = draft?.tasks.filter((t) => t.checked && t.title.trim()).length ?? 0;

  async function accept() {
    if (d.busy) return;
    const r = await d.accept("full");
    if (!r) return;
    setSaved((n) => n + 1);
    toast(`Saved${r.tasks ? ` with ${r.tasks} ${r.tasks === 1 ? "task" : "tasks"}` : ""}`, "ok");
    next();
  }
  async function dismiss() {
    if (d.busy) return;
    if (await d.dismiss()) { setDismissed((n) => n + 1); next(); }
  }

  // swipe: right accepts, left dismisses (only clearly horizontal moves count)
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const onStart = (e: React.TouchEvent) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const dx = e.touches[0].clientX - start.current.x;
    const dy = e.touches[0].clientY - start.current.y;
    setDrag(Math.abs(dx) > Math.abs(dy) * 1.5 ? Math.max(-120, Math.min(120, dx)) : 0);
  };
  const onEnd = () => {
    const dx = drag;
    start.current = null;
    setDrag(0);
    if (dx > 90) void accept();
    else if (dx < -90) void dismiss();
  };

  if (queue === null) return <Loading />;
  if (total === 0 || i >= total) {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-sm flex-col items-center justify-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-ai-bg text-accent"><Sparkles size={22} aria-hidden /></span>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">{total === 0 ? "Nothing to review" : "All caught up"}</h1>
        <p className="m-0 text-[15px] text-muted">{total === 0 ? "No captures are waiting. New ones appear here after your local model has drafted them." : `${saved} saved, ${dismissed} dismissed${total - saved - dismissed ? `, ${total - saved - dismissed} skipped` : ""}.`}</p>
        <Link href="/" className="mt-3 flex h-[54px] w-full items-center justify-center rounded-[14px] bg-primary text-base font-semibold text-primary-fg">Back to Today</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-xl flex-col gap-3.5" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
      <header className="flex items-center gap-2">
        <Link href="/inbox" className="flex min-h-11 min-w-[72px] items-center gap-0.5 text-base text-muted"><ChevronLeft size={20} aria-hidden strokeWidth={2} />Inbox</Link>
        <h1 className="m-0 flex-1 text-center font-mono text-[13px] font-medium text-muted">{i + 1} OF {total}</h1>
        <button type="button" onClick={next} className="min-h-11 min-w-[72px] text-right text-base text-muted">Skip</button>
      </header>
      <div aria-hidden className="flex gap-1">{queue.map((q, n) => <span key={q} className="h-[3px] flex-1 rounded-sm" style={{ background: n <= i ? "var(--accent)" : "var(--border)" }} />)}</div>

      {!c || !draft ? <Loading /> : (
        <div className="flex flex-1 flex-col gap-3.5" style={{ transform: `translateX(${drag}px)`, transition: drag ? "none" : "transform 160ms ease" }}>
          <section aria-labelledby="raw-h" className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface px-4 py-3.5">
            <h2 id="raw-h" className="m-0 text-[12.5px] font-semibold text-muted">You captured · {c.kind === "link" ? "Link" : c.kind === "task" ? "Task" : "Note"} · {new Date(c.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</h2>
            <p className="m-0 line-clamp-3 text-[14.5px] leading-normal text-pretty">{c.content}</p>
          </section>

          <section aria-labelledby="pr-h" className="flex flex-col gap-3.5 rounded-[14px] border border-dashed border-ai-line bg-ai-soft p-4">
            <div className="flex items-center gap-2">
              <Sparkles size={15} aria-hidden strokeWidth={1.8} className="text-accent" />
              <h2 id="pr-h" className="m-0 text-[12.5px] font-semibold text-accent">Your local AI suggests</h2>
              <button type="button" onClick={() => setEditing((e) => !e)} className="ml-auto min-h-9 px-1 text-[13.5px] font-medium text-muted">{editing ? "Done" : "Edit"}</button>
            </div>
            {editing ? (
              <div className="flex flex-col gap-2">
                <label className="sr-only" htmlFor="rf-title">Title</label>
                <input id="rf-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-12 w-full rounded-xl border border-line bg-surface px-3 text-[17px] font-semibold text-fg" />
                <label className="sr-only" htmlFor="rf-sum">Summary</label>
                <textarea id="rf-sum" rows={4} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] leading-normal text-fg" />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="m-0 text-[19px] leading-[1.3] font-semibold tracking-[-0.01em]">{draft.title}</p>
                {draft.summary && <p className="m-0 text-sm leading-normal text-muted">{draft.summary}</p>}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {draft.tags.map((t) => <span key={t} className="flex h-7 items-center rounded-lg bg-surface2 px-2.5 font-mono text-xs">#{t}</span>)}
              {draft.projectId && <span className="flex h-7 items-center gap-1.5 rounded-lg bg-surface2 px-2.5 text-[12.5px] text-muted"><ProjectSquare color={colorOf(draft.projectId)} />{live.find((p) => p.id === draft.projectId)?.name}</span>}
            </div>
            {(draft.tasks.length > 0 || draft.related) && (
              <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="pb-1.5 text-[12.5px] font-semibold text-muted">Also create</legend>
                {draft.tasks.map((t, n) => (
                  <label key={t.key} className="flex min-h-[52px] items-center gap-3 rounded-[11px] bg-surface px-3.5 text-sm">
                    <input type="checkbox" checked={t.checked} onChange={(e) => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === n ? { ...x, checked: e.target.checked } : x)) })} className="size-5 shrink-0 accent-[var(--accent)]" />
                    <span className="flex-1 leading-snug">Task: {t.title}</span>
                    {t.due && <span className="font-mono text-[11.5px] text-faint">{t.due.slice(5)}</span>}
                  </label>
                ))}
                {draft.related && (
                  <label className="flex min-h-[52px] items-center gap-3 rounded-[11px] bg-surface px-3.5 text-sm">
                    <input type="checkbox" checked={draft.linkRelated} onChange={(e) => setDraft({ ...draft, linkRelated: e.target.checked })} className="size-5 shrink-0 accent-[var(--accent)]" />
                    <span className="flex-1 leading-snug">Link to “{draft.related.title}”</span>
                  </label>
                )}
              </fieldset>
            )}
          </section>

          <div className="mt-auto flex flex-col gap-2.5 pt-1">
            <div className="flex gap-2.5">
              <button type="button" onClick={() => void dismiss()} disabled={!!d.busy} className="h-[54px] flex-1 rounded-[14px] border border-line2 bg-surface text-base font-medium disabled:opacity-50">Dismiss</button>
              <button type="button" onClick={() => void accept()} disabled={!!d.busy || !draft.title.trim()} className="h-[54px] flex-[2] rounded-[14px] bg-primary text-base font-semibold text-primary-fg disabled:opacity-50">Accept</button>
            </div>
            <p className="m-0 text-center text-[12.5px] text-faint">Accept saves one note{ticked ? ` and ${ticked} ${ticked === 1 ? "task" : "tasks"}` : ""}. Swipe right to accept, left to dismiss.</p>
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{c ? `Reviewing ${titleOf(c)}` : ""}</span>
    </div>
  );
}
