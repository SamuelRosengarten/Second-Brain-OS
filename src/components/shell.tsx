"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, FileText, Inbox, Plus, Search, SlidersHorizontal, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ProjectSquare, ProjectsProvider, projectColorVar, useProjects } from "./blocks";
import { useApi } from "./client";
import { CommandPalette } from "./command-palette";
import { cx, ToastProvider } from "./ui";

interface NavItem { href: string; label: string; icon: LucideIcon; match: string[] }
const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: Sun, match: ["/"] },
  { href: "/inbox", label: "Inbox", icon: Inbox, match: ["/inbox"] },
  { href: "/knowledge", label: "Notes", icon: FileText, match: ["/knowledge"] },
  { href: "/plan", label: "Plan", icon: CalendarDays, match: ["/plan", "/workflow", "/tasks", "/pipeline"] },
  { href: "/ai", label: "Ask", icon: Sparkles, match: ["/ai"] },
];
/** Pages that draw their own phone header (and need no slim top bar). */
const OWN_HEADER = ["/", "/inbox", "/knowledge", "/plan", "/workflow", "/ai", "/capture"];
/** Full-screen phone flows have no tab bar. */
const NO_TABS = ["/capture", "/inbox/review"];

function isActive(path: string, item: NavItem): boolean {
  return item.match.some((m) => (m === "/" ? path === "/" : path === m || path.startsWith(m + "/")));
}

const PaletteCtx = createContext<() => void>(() => undefined);
export const useOpenPalette = () => useContext(PaletteCtx);

interface Status { ollama: { ok: boolean }; chatModel: { name: string } }

function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" />
      <path d="M7.4 9.3l3.4 6.4M16.8 8.2l-3.6 7.5M8.5 6.8h7" />
    </svg>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const review = useApi<{ captures: unknown[] }>("/api/captures?status=proposed");
  const status = useApi<Status>("/api/status");
  const { projects } = useProjects();
  const reviewCount = review.data?.captures.length ?? 0;
  const { reload: reloadReview } = review;
  const [modKey, setModKey] = useState("Ctrl");

  useEffect(() => { void reloadReview(); }, [path, reloadReview]);
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform)) setModKey("⌘"); }, []);
  // Ctrl/Cmd+K opens the palette anywhere; a bare "n" (outside text fields) starts a new capture.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        router.push("/capture");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [router]);
  const openPalette = useCallback(() => setPalette(true), []);

  const ollama = status.data?.ollama.ok;
  const model = status.data?.chatModel.name;
  const active = projects.filter((p) => p.status !== "archived").sort((a, b) => a.color_index - b.color_index);
  const tabs = !NO_TABS.includes(path);
  const ownHeader = OWN_HEADER.some((r) => (r === "/" ? path === "/" : path === r || path.startsWith(r + "/")));
  const onProject = (id: string) => path === `/projects/${id}`;

  return (
    <PaletteCtx.Provider value={openPalette}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-fg">Skip to content</a>
      <div className="flex min-h-dvh">
        {/* ---------- desktop sidebar ---------- */}
        <aside aria-label="App" className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-[18px] border-r border-line bg-sidebar px-3 py-4 lg:flex">
          <Link href="/" aria-label="Second Brain, Today" className="flex items-center gap-2.5 px-1.5 py-0.5">
            <span className="grid size-7 place-items-center rounded-lg bg-ai-bg text-accent"><BrandMark /></span>
            <span className="text-sm font-semibold tracking-tight">Second Brain</span>
          </Link>

          <div className="flex flex-col gap-2">
            <Link href="/capture" className="flex h-10 items-center gap-2 rounded-[10px] bg-primary px-3 text-[13.5px] font-semibold text-primary-fg hover:bg-primary-hover">
              <Plus size={16} aria-hidden strokeWidth={2} />
              <span className="flex-1">New capture</span>
              <span aria-hidden className="rounded-[5px] bg-black/10 px-1.5 py-px font-mono text-[11px]">N</span>
            </Link>
            <button type="button" onClick={openPalette} className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] text-muted hover:bg-hover">
              <Search size={16} aria-hidden strokeWidth={1.8} />
              <span className="flex-1 text-left">Search or jump to…</span>
              <span aria-hidden className="font-mono text-[11px] text-faint">{modKey} K</span>
            </button>
          </div>

          <nav aria-label="Sections" className="flex flex-col gap-0.5">
            {NAV.map((n) => {
              const on = isActive(path, n);
              return (
                <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cx("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]", on ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover/60 hover:text-fg")}>
                  <n.icon size={17} aria-hidden strokeWidth={1.8} />
                  {n.label}
                  {n.href === "/inbox" && reviewCount > 0 && <span className="ml-auto rounded-full bg-ai-bg px-[7px] py-px font-mono text-[11px] text-accent" aria-label={`${reviewCount} to review`}>{reviewCount}</span>}
                </Link>
              );
            })}
          </nav>

          {active.length > 0 && (
            <div className="min-h-0 overflow-y-auto">
              <Link href="/projects" className="block px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] text-faint uppercase hover:text-fg">Projects</Link>
              <ul className="flex flex-col gap-0.5">
                {active.slice(0, 8).map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} aria-current={onProject(p.id) ? "page" : undefined} className={cx("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] hover:bg-hover/60 hover:text-fg", onProject(p.id) ? "bg-hover text-fg" : "text-muted")}>
                      <ProjectSquare color={projectColorVar(p.color_index)} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="font-mono text-[11px] text-faint">{p.open_tasks}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto flex flex-col gap-2">
            <div className="flex flex-col gap-0.5 rounded-[10px] border border-line px-3 py-2.5" role="status">
              <div className="flex items-center gap-2 text-[12.5px]">
                <span aria-hidden className={cx("size-[7px] rounded-full", ollama === undefined ? "bg-faint" : ollama ? "bg-ok" : "bg-danger")} />
                {ollama === undefined ? "Checking the local AI…" : ollama ? `${model ?? "Local model"} is running` : "Local AI is offline"}
              </div>
              <div className="text-xs text-faint">Local only · nothing leaves this PC</div>
            </div>
            <Link href="/settings" aria-current={path === "/settings" || path.startsWith("/settings/") || path === "/automations" ? "page" : undefined} className={cx("flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13px] hover:bg-hover/60 hover:text-fg", path === "/settings" || path === "/automations" ? "bg-hover text-fg" : "text-muted")}>
              <SlidersHorizontal size={16} aria-hidden strokeWidth={1.8} />
              Settings &amp; automations
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* ---------- phone: slim back bar on pages without their own header ---------- */}
          {!ownHeader && (
            <header className="safe-top sticky top-0 z-30 flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-1 border-b border-line bg-bg/95 px-2 backdrop-blur lg:hidden">
              <button type="button" onClick={() => router.back()} aria-label="Back" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-hover"><ChevronLeft size={22} aria-hidden /></button>
              <Link href="/" className="flex-1 truncate text-sm font-semibold tracking-tight">Second Brain</Link>
              <button type="button" onClick={openPalette} aria-label="Search and commands" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-hover"><Search size={19} aria-hidden strokeWidth={1.8} /></button>
            </header>
          )}
          <main id="main" className={cx("min-w-0 flex-1 px-4 pt-5 lg:px-10 lg:pt-8 lg:pb-12", tabs ? "pb-[calc(6.5rem+env(safe-area-inset-bottom))]" : "pb-[calc(1.5rem+env(safe-area-inset-bottom))]")}>{children}</main>
        </div>
      </div>

      {/* ---------- phone tab bar ---------- */}
      {tabs && <nav aria-label="Mobile" className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-sidebar px-1 pt-1 lg:hidden">
        {NAV.map((n) => {
          const on = isActive(path, n);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cx("flex min-h-[52px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px]", on ? "font-semibold text-fg" : "text-faint")}>
              <span className="relative grid">
                <n.icon size={22} aria-hidden strokeWidth={1.8} />
                {n.href === "/inbox" && reviewCount > 0 && <span className="absolute -top-[5px] -right-2.5 h-4 min-w-4 rounded-full bg-accent px-1 text-center text-[10.5px] leading-4 font-bold text-accent-fg" aria-label={`${reviewCount} to review`}>{reviewCount}</span>}
              </span>
              {n.label}
            </Link>
          );
        })}
      </nav>}

      <CommandPalette open={palette} onClose={() => setPalette(false)} projects={active.map((p) => ({ id: p.id, name: p.name }))} />
    </PaletteCtx.Provider>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <ToastProvider>
      <ProjectsProvider refreshOn={path}>
        <ShellInner>{children}</ShellInner>
      </ProjectsProvider>
    </ToastProvider>
  );
}
