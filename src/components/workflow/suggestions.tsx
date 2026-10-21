"use client";
import { Sparkles } from "lucide-react";
import type { Model } from "./model";

/** The design's "Needs your review" panel: AI-proposed dependencies. Nothing changes until you press Accept. */
export function SuggestionsPanel({ model: m, showLow, onToggleLow, onAccept, onDismiss }: {
  model: Model; showLow: boolean; onToggleLow: () => void; onAccept: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const short = (id: string) => m.graph.byId.get(id)?.title ?? "";
  const n = m.suggestions.length;
  const hasLow = m.lowHidden > 0 || (showLow && n > 0);
  if (n === 0 && m.lowHidden === 0) return null; // nothing left to review
  return (
    <section aria-label="Suggested dependencies" className="flex flex-col gap-3 rounded-xl border bg-[var(--wf-panel)] px-4 py-4 sm:px-5" style={{ borderColor: "var(--wf-sugline)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Sparkles size={16} aria-hidden style={{ color: "var(--wf-acc)" }} />
        <span className="text-[11px] font-medium tracking-[0.08em] text-[var(--wf-muted)] uppercase">Needs your review</span>
        <span className="text-[13px] text-[var(--wf-soft)]">
          {n > 0 ? `${n} ${n === 1 ? "dependency" : "dependencies"} suggested by your local AI. Nothing changes until you accept.` : "No confident suggestions right now."}
        </span>
        {hasLow && (
          <button type="button" onClick={onToggleLow} className="h-10 rounded-lg border border-[var(--wf-btnline)] bg-transparent px-3 text-xs text-[var(--wf-soft)] sm:ml-auto">
            {showLow ? "Hide low-confidence suggestions" : `Show ${m.lowHidden} low-confidence suggestion${m.lowHidden === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      <ul className="flex flex-col">
        {m.suggestions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-[var(--wf-line2)] py-2.5">
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-[var(--wf-strong)]">{short(s.a)} → {short(s.b)}</span>
              <span className="text-[13px] text-[var(--wf-muted)]">{s.why}</span>
            </div>
            <span className="text-xs text-[var(--wf-muted)]">{s.conf}% match</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => onAccept(s.id)} aria-label={`Accept: ${short(s.a)} before ${short(s.b)}`} className="h-11 rounded-lg px-4 text-[13px] font-semibold text-white sm:h-10" style={{ background: "var(--wf-primary)" }}>Accept</button>
              <button type="button" onClick={() => onDismiss(s.id)} aria-label={`Dismiss: ${short(s.a)} before ${short(s.b)}`} className="h-11 rounded-lg border border-[var(--wf-btnline)] bg-transparent px-4 text-[13px] text-[var(--wf-soft)] sm:h-10">Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
