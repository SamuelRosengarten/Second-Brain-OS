"use client";
import Link from "next/link";
import { Check, Circle, LoaderCircle, Search, Sparkles, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cx } from "../ui";
import { titleOf } from "./use-draft";
import type { Capture } from "@/lib/captures";

export type Tab = "review" | "unprocessed" | "saved" | "dismissed";
const KIND: Record<Capture["kind"], string> = { text: "Note", idea: "Note", task: "Task", project_note: "Note", link: "Link", excerpt: "Note", file: "File" };
const STATE: Record<Capture["status"], { icon: LucideIcon; text: string; color: string; spin?: boolean }> = {
  proposed: { icon: Sparkles, text: "To review", color: "var(--accent)" },
  processing: { icon: LoaderCircle, text: "Processing…", color: "var(--warn)", spin: true },
  new: { icon: Circle, text: "Not processed", color: "var(--faint)" },
  failed: { icon: TriangleAlert, text: "Failed", color: "var(--danger)" },
  accepted: { icon: Check, text: "Saved", color: "var(--ok)" },
  dismissed: { icon: X, text: "Dismissed", color: "var(--faint)" },
};

export const tabOf = (c: Capture): Tab => (c.status === "proposed" ? "review" : c.status === "accepted" ? "saved" : c.status === "dismissed" ? "dismissed" : "unprocessed");

const hhmm = (iso: string) => {
  const d = new Date(iso);
  const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  if (d >= midnight) return t;
  const yesterday = new Date(midnight); yesterday.setDate(yesterday.getDate() - 1);
  return d >= yesterday ? "Yesterday" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function filterCaptures(captures: Capture[], tab: Tab, q: string): Capture[] {
  const term = q.trim().toLowerCase();
  return captures.filter((c) => tabOf(c) === tab && (!term || `${c.content} ${c.url} ${c.proposal?.title ?? ""} ${c.proposal?.summary ?? ""} ${c.proposal?.tags.join(" ") ?? ""}`.toLowerCase().includes(term)));
}
export function countCaptures(captures: Capture[]): Record<Tab, number> {
  const c: Record<Tab, number> = { review: 0, unprocessed: 0, saved: 0, dismissed: 0 };
  for (const x of captures) c[tabOf(x)]++;
  return c;
}

/** Left column of the inbox: filter tabs, search and one row per capture. Selection is the URL (/inbox/<id>). */
export function CaptureList({ items, counts, selectedId, tab, onTab, q, onQ, onProcessAll, processing }: {
  items: Capture[]; counts: Record<Tab, number>; selectedId: string | null; tab: Tab; onTab: (t: Tab) => void; q: string; onQ: (q: string) => void; onProcessAll: () => void; processing: boolean;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "review", label: "To review" },
    { id: "unprocessed", label: "Unprocessed" },
    { id: "saved", label: "Saved" },
    ...(counts.dismissed > 0 ? [{ id: "dismissed" as const, label: "Dismissed" }] : []),
  ];
  const open = counts.review + counts.unprocessed;

  return (
    <section aria-labelledby="inbox-h" className="flex min-w-0 flex-col gap-3.5">
      <div className="flex items-baseline gap-2 px-1.5">
        <h1 id="inbox-h" className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Inbox</h1>
        <span className="font-mono text-xs text-faint">{open} open</span>
      </div>
      <div role="tablist" aria-label="Filter captures" className="flex gap-1 overflow-x-auto px-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)} className={cx("flex h-10 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] lg:h-[30px]", tab === t.id ? (t.id === "review" ? "bg-ai-bg font-medium text-accent" : "bg-surface2 font-medium text-fg") : "text-muted hover:text-fg")}>
            {t.label}{counts[t.id] > 0 && <span className="font-mono text-[11px] opacity-80">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="relative px-1">
        <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
        <label htmlFor="inbox-q" className="sr-only">Search the inbox</label>
        <input id="inbox-q" type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="Search the inbox" className="h-11 w-full rounded-[9px] border border-line bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-faint lg:h-9 lg:text-[13px]" />
      </div>

      {items.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
          {q ? "No captures match." : tab === "review" ? "Nothing waiting for review." : tab === "unprocessed" ? "Everything has been processed." : "Nothing here yet."}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {items.map((c) => {
            const s = STATE[c.status];
            const on = c.id === selectedId;
            return (
              <li key={c.id}>
                <Link href={`/inbox/${c.id}`} aria-current={on ? "true" : undefined} className={cx("flex gap-2.5 rounded-[10px] px-2.5 py-[11px]", on ? "bg-hover" : "hover:bg-hover/50")}>
                  <s.icon size={16} aria-hidden strokeWidth={1.8} className={cx("mt-px shrink-0", s.spin && "animate-spin")} style={{ color: s.color }} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13.5px] font-medium">{titleOf(c)}</span>
                    <span className="truncate text-[12.5px] text-muted">{c.proposal?.summary ?? c.content.replace(/\s+/g, " ")}</span>
                    <span className="flex gap-2 font-mono text-[11px] text-faint">
                      <span>{KIND[c.kind]} · {hhmm(c.created_at)}</span>
                      <span className="ml-auto" style={{ color: s.color }}>{s.text}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {counts.unprocessed > 0 && tab !== "unprocessed" && (
        <button type="button" onClick={onProcessAll} disabled={processing} className="h-11 rounded-[9px] border border-line text-[13px] text-muted hover:bg-hover disabled:opacity-50 lg:h-9">
          {processing ? "Processing…" : `Process ${counts.unprocessed} unprocessed ${counts.unprocessed === 1 ? "capture" : "captures"}`}
        </button>
      )}
    </section>
  );
}
