"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, cx, ToastProvider } from "./ui";
import { useApi } from "./client";

const DESKTOP = [
  { href: "/", label: "Home", icon: "◧" },
  { href: "/inbox", label: "Inbox", icon: "▤" },
  { href: "/knowledge", label: "Knowledge", icon: "❖" },
  { href: "/projects", label: "Projects", icon: "◈" },
  { href: "/tasks", label: "Tasks", icon: "☑" },
  { href: "/ai", label: "AI Workspace", icon: "✦" },
  { href: "/automations", label: "Automations", icon: "↻" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];
const MOBILE = [
  { href: "/", label: "Home", icon: "◧" },
  { href: "/capture", label: "Capture", icon: "＋" },
  { href: "/search", label: "Search", icon: "⌕" },
  { href: "/inbox", label: "Inbox", icon: "▤" },
  { href: "/more", label: "More", icon: "☰" },
];
const MORE_ROUTES = ["/more", "/knowledge", "/projects", "/tasks", "/ai", "/automations", "/settings"];

function active(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  if (href === "/more") return MORE_ROUTES.some((r) => path === r || path.startsWith(r + "/"));
  return path === href || path.startsWith(href + "/");
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const review = useApi<{ captures: unknown[] }>("/api/captures?status=proposed");
  const count = review.data?.captures.length ?? 0;
  return (
    <ToastProvider>
      <div className="mx-auto flex min-h-dvh max-w-[1400px]">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line p-4 md:flex">
          <Link href="/" className="mb-6 px-2 py-1 text-lg font-semibold tracking-tight">
            Second Brain <span className="text-accent">OS</span>
          </Link>
          <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
            {DESKTOP.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(path, n.href) ? "page" : undefined} className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", active(path, n.href) ? "bg-surface2 text-fg" : "text-muted hover:bg-surface hover:text-fg")}>
                <span aria-hidden className="w-5 text-center">{n.icon}</span>
                {n.label}
                {n.href === "/inbox" && count > 0 && <span className="ml-auto"><Badge tone="accent">{count}</Badge></span>}
              </Link>
            ))}
          </nav>
          <Link href="/capture" className="mt-4 rounded-lg bg-accent px-3 py-2.5 text-center text-sm font-semibold text-accent-fg hover:opacity-90">
            Quick capture
          </Link>
        </aside>
        <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-10">{children}</main>
      </div>
      <nav aria-label="Mobile" className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur md:hidden">
        {MOBILE.map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(path, n.href) ? "page" : undefined} className={cx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(path, n.href) ? "text-accent" : "text-muted")}>
            <span aria-hidden className="text-lg leading-none">{n.icon}</span>
            {n.label}
            {n.href === "/inbox" && count > 0 && <span className="absolute top-1 right-[28%] rounded-full bg-accent px-1.5 text-[10px] text-accent-fg">{count}</span>}
          </Link>
        ))}
      </nav>
    </ToastProvider>
  );
}
