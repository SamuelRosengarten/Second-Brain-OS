"use client";
import Link from "next/link";
import { CircleCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean };
export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const base = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45";
  const sizes = { sm: "h-9 px-3 text-[13px] lg:h-8", md: "h-11 px-4 text-sm font-semibold lg:h-10 lg:text-[13.5px]" };
  const variants = {
    primary: "bg-primary font-semibold text-primary-fg hover:bg-primary-hover",
    secondary: "border border-line bg-transparent text-fg hover:bg-hover",
    ghost: "text-muted hover:bg-hover hover:text-fg",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
  };
  return (
    <button type="button" className={cx(base, sizes[size], variants[variant], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** Icon-only button. `label` becomes both the accessible name and the tooltip. */
export function IconButton({ icon: Icon, label, className, size = 16, ...rest }: { icon: LucideIcon; label: string; size?: number } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button type="button" aria-label={label} title={label} className={cx("inline-grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-fg disabled:opacity-45 lg:size-8", className)} {...rest}>
      <Icon size={size} aria-hidden strokeWidth={1.75} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ---------- form controls ---------- */
const hasWidth = (c?: string) => /(^|\s)(sm:|md:|lg:)?w-/.test(c ?? "");
const field = "min-w-0 rounded-[9px] border border-line bg-surface px-3 py-2 text-fg placeholder:text-faint hover:border-line2 focus:border-accent focus-visible:outline-offset-0";
export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(field, !hasWidth(className) && "w-full", "h-10 lg:h-8", className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cx(field, !hasWidth(className) && "w-full", "min-h-24 resize-y leading-relaxed", className)} {...p} />;
}
export function Select({ className, children, ...p }: ComponentProps<"select">) {
  return (
    <select className={cx(field, !hasWidth(className) && "w-full", "h-10 lg:h-8 lg:py-0", className)} {...p}>
      {children}
    </select>
  );
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

/* ---------- layout ---------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("min-w-0 rounded-lg border border-line bg-surface p-4", className)}>{children}</section>;
}
export function CardTitle({ children, action, icon: Icon }: { children: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-faint uppercase">
        {Icon && <Icon size={14} aria-hidden strokeWidth={1.75} />}
        {children}
      </h2>
      {action}
    </div>
  );
}

/** Flat section (no box): a heading row followed by content. Used for list-style layouts. */
export function Section({ title, action, icon, children, className }: { title: string; action?: ReactNode; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <section className={cx("min-w-0", className)}>
      <CardTitle action={action} icon={icon}>{title}</CardTitle>
      {children}
    </section>
  );
}

export interface Crumb { label: string; href?: string }
export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: string; actions?: ReactNode; crumbs?: Crumb[] }) {
  return (
    <header className="mb-6">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-xs text-faint">
          {crumbs.map((c, i) => (
            <span key={c.label} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {c.href ? <Link href={c.href} className="hover:text-fg">{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Metadata row (Notion-style property): icon + label on the left, value on the right. */
export function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-start gap-3 py-1.5 text-[13px] sm:grid-cols-[9rem_1fr]">
      <dt className="flex items-center gap-2 text-faint">
        <Icon size={14} aria-hidden strokeWidth={1.75} />
        {label}
      </dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

/* ---------- status ---------- */
const tones = {
  neutral: "bg-surface2 text-muted",
  accent: "bg-ai-bg text-accent",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", children, icon: Icon }: { tone?: Tone; children: ReactNode; icon?: LucideIcon }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>
      {Icon && <Icon size={12} aria-hidden strokeWidth={2} />}
      {children}
    </span>
  );
}

export function EmptyState({ title, children, action, icon: Icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      {Icon && <Icon size={20} aria-hidden strokeWidth={1.5} className="mx-auto mb-3 text-faint" />}
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, hint, onRetry }: { message: string; hint?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-danger/35 bg-danger/10 p-3 text-[13px]">
      <div className="flex min-w-0 gap-2">
        <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0">
          <p className="font-medium text-danger">{message}</p>
          {hint && <p className="mt-1 font-mono text-xs break-words text-muted">{hint}</p>}
        </div>
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton", className)} />;
}
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line rounded-lg border border-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="hidden h-3.5 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 py-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-5/6" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

/* ---------- overlays ---------- */
/** Native <dialog>: focus trapping, Escape-to-close and focus restore are handled by the browser. */
/** `noKeyboardOnTouch`: do not auto-focus the first field on touch screens, so opening the dialog does not raise the keyboard. */
export function Dialog({ open, onClose, title, children, footer, noKeyboardOnTouch, wide }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; footer?: ReactNode; noKeyboardOnTouch?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (noKeyboardOnTouch && window.matchMedia("(pointer: coarse)").matches) (document.activeElement as HTMLElement | null)?.blur();
    }
    if (!open && d.open) d.close();
  }, [open, noKeyboardOnTouch]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={title} className={cx("m-auto max-h-[90dvh] overflow-y-auto rounded-xl border border-line bg-surface2 p-0 shadow-2xl", wide ? "w-[min(96vw,62rem)]" : "w-[min(94vw,30rem)]")}>
      <div className="space-y-3 p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="text-[13px] text-muted">{children}</div>
      </div>
      {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface2 p-3">{footer}</div>}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", busy, onConfirm, onCancel }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}

/* ---------- toasts ---------- */
export type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; text: string; tone: "ok" | "danger"; action?: ToastAction };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"], action?: ToastAction) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok", action?: ToastAction) => {
    const id = Date.now() + Math.random();
    const dismiss = () => setItems((i) => i.filter((t) => t.id !== id));
    setItems((i) => [...i, { id, text, tone, action: action && { label: action.label, onClick: () => { dismiss(); action.onClick(); } } }]);
    setTimeout(dismiss, action || tone === "danger" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border bg-surface2 px-3.5 py-2.5 text-[13px] shadow-xl", t.tone === "danger" ? "border-danger/50" : "border-line")}>
            {t.tone === "danger" ? <TriangleAlert size={16} aria-hidden className="mt-px shrink-0 text-danger" /> : <CircleCheck size={16} aria-hidden className="mt-px shrink-0 text-ok" />}
            <span>{t.text}</span>
            {t.action && (
              <button type="button" onClick={t.action.onClick} className="-my-1 -mr-1.5 ml-2 min-h-9 shrink-0 rounded-md px-2.5 text-[13px] font-semibold text-accent hover:bg-hover">
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- segmented control ---------- */
export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; count?: number }[]; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-[10px] border border-line bg-surface p-[3px]">
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cx("flex h-10 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap lg:h-8", value === t.id ? "bg-surface2 text-fg" : "text-muted hover:text-fg")}>
          {t.label}
          {t.count !== undefined && <span className="font-mono text-[11px] text-faint">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- list rows ---------- */
export const rowClass = "group flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-hover/60";
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx("overflow-hidden rounded-xl border border-line bg-surface", className)}>{children}</ul>;
}
