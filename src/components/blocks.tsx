"use client";
import { Sparkles } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useApi } from "./client";
import { cx } from "./ui";

/* ---------- project colors ---------- */

export interface ProjectLite { id: string; name: string; status: string; color_index: number; open_tasks: number }

/** The CSS color of a project's square, bars and chips. The index comes from the server so every screen agrees. */
export const projectColorVar = (index: number): string => `var(--pc${((index % 8) + 8) % 8})`;

interface ProjectsCtx { projects: ProjectLite[]; colorOf: (id: string | null | undefined) => string; reload: () => Promise<void> }
const Ctx = createContext<ProjectsCtx>({ projects: [], colorOf: () => "var(--faint)", reload: async () => undefined });
export const useProjects = () => useContext(Ctx);

/** Loads the project list once for the whole app (sidebar, pickers, colors) and refreshes it when `refreshOn` changes. */
export function ProjectsProvider({ refreshOn, children }: { refreshOn: string; children: ReactNode }) {
  const { data, reload } = useApi<{ projects: ProjectLite[] }>("/api/projects");
  useEffect(() => { void reload(); }, [refreshOn, reload]);
  const projects = useMemo(() => data?.projects ?? [], [data]);
  const colorOf = useCallback(
    (id: string | null | undefined) => {
      const p = projects.find((x) => x.id === id);
      return p ? projectColorVar(p.color_index) : "var(--faint)";
    },
    [projects],
  );
  const value = useMemo(() => ({ projects, colorOf, reload: async () => { await reload(); } }), [projects, colorOf, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ---------- small building blocks of the redesign ---------- */

/** The little rounded square that stands for a project. */
export function ProjectSquare({ color, size = 8, className }: { color: string; size?: number; className?: string }) {
  return <span aria-hidden className={cx("inline-block shrink-0 rounded-[3px]", className)} style={{ width: size, height: size, background: color }} />;
}

/** Violet dashed panel: where the local AI proposes something you still have to accept. */
export function AiPanel({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "aside" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx("rounded-xl border border-dashed border-ai-line bg-ai-soft", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function AiHeading({ children, id, count, className }: { children: ReactNode; id?: string; count?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <Sparkles size={15} aria-hidden strokeWidth={1.8} className="shrink-0 text-accent" />
      <h2 id={id} className="m-0 text-sm font-semibold">{children}</h2>
      {count !== undefined && <span className="ml-auto font-mono text-xs text-accent">{count}</span>}
    </div>
  );
}

/** Small uppercase mono label (WED 21 OCT, REVIEW 1 OF 3). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-xs tracking-[0.04em] text-faint uppercase", className)}>{children}</span>;
}

/** The round "complete" circle used in every task row. A 44px hit area on phones, 28px on desktop. */
export function TaskCircle({ label, done, onClick, color }: { label: string; done?: boolean; onClick: () => void; color?: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={done} onClick={onClick} className="grid size-11 shrink-0 place-items-center rounded-full lg:size-7">
      <span className="grid size-[22px] place-items-center rounded-full border-[1.5px] lg:size-5" style={{ borderColor: done ? (color ?? "var(--ok)") : "var(--faint)", background: done ? (color ?? "var(--ok)") : "transparent" }}>
        {done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5L20 7" /></svg>}
      </span>
    </button>
  );
}

/** Segmented control made of links or buttons (the Week | Timeline | Graph switch). */
export function Segmented({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return <nav aria-label={label} className={cx("inline-flex rounded-[10px] border border-line bg-surface p-[3px]", className)}>{children}</nav>;
}
export const segmentClass = (on: boolean) =>
  cx("flex h-10 items-center rounded-[7px] px-3.5 text-[13px] lg:h-8", on ? "bg-surface2 font-medium text-fg" : "text-muted hover:text-fg");
