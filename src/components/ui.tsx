"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean };
export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none";
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm" };
  const variants = {
    primary: "bg-accent text-accent-fg hover:opacity-90",
    secondary: "bg-surface2 text-fg border border-line hover:border-muted",
    ghost: "text-muted hover:text-fg hover:bg-surface2",
    danger: "bg-transparent text-danger border border-danger/50 hover:bg-danger/10",
  };
  return (
    <button type="button" className={cx(base, sizes[size], variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

const field = "w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-fg placeholder:text-muted/70 focus:border-accent";
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(field, "h-10", className)} {...p} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(field, "min-h-24 resize-y", className)} {...p} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(field, "h-10", className)} {...p}>
      {children}
    </select>
  );
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("min-w-0 rounded-xl border border-line bg-surface p-4 md:p-5", className)}>{children}</section>;
}
export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const tones = {
  neutral: "bg-surface2 text-muted",
  accent: "bg-accent/15 text-accent",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, hint, onRetry }: { message: string; hint?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
      <div>
        <p className="font-medium text-danger">{message}</p>
        {hint && <p className="mt-1 font-mono text-xs text-muted">{hint}</p>}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted">
      <Spinner /> {label}…
    </div>
  );
}

/** Native <dialog>: focus trapping, Escape-to-close and backdrop handled by the browser. */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} className="m-auto w-[min(92vw,30rem)] rounded-xl border border-line bg-surface p-0 shadow-2xl">
      <div className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="text-sm text-muted">{children}</div>
      </div>
      {footer && <div className="flex justify-end gap-2 border-t border-line p-4">{footer}</div>}
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
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}

// ---- toasts ----
type Toast = { id: number; text: string; tone: "ok" | "danger" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((i) => [...i, { id, text, tone }]);
    setTimeout(() => setItems((i) => i.filter((t) => t.id !== id)), tone === "danger" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto max-w-md rounded-lg border bg-surface px-4 py-2.5 text-sm shadow-lg", t.tone === "danger" ? "border-danger/50 text-danger" : "border-line")}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-line bg-surface p-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cx("rounded-md px-3 py-1.5 text-sm font-medium", value === t.id ? "bg-surface2 text-fg" : "text-muted hover:text-fg")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export { cx };
