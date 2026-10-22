import { cx } from "../ui";
import { LIMIT_PCT, type LoadSegment } from "./plan-utils";

const HATCH = "repeating-linear-gradient(135deg, var(--warn) 0 2px, color-mix(in srgb, var(--warn) 22%, transparent) 2px 5px)";

/** A day's planned hours: one coloured piece per task, a marker at the daily limit, and whatever is over drawn hatched. */
export function LoadBar({ segments, className }: { segments: LoadSegment[]; className?: string }) {
  return (
    <div aria-hidden className={cx("relative h-2 rounded-[3px]", className)} style={{ background: `linear-gradient(90deg, var(--elevated) 0 ${LIMIT_PCT}%, transparent ${LIMIT_PCT}%)` }}>
      <div className="flex h-full gap-px overflow-hidden rounded-[3px]">
        {segments.map((s, i) => <span key={i} className="block h-full flex-none" style={{ width: `${s.w}%`, background: s.over ? HATCH : s.color, opacity: s.faded ? 0.4 : 1 }} />)}
      </div>
      <span className="absolute -top-[3px] block h-3.5 w-0.5 rounded-[1px] bg-muted" style={{ left: `${LIMIT_PCT}%` }} />
    </div>
  );
}
