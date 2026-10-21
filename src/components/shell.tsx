"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, FileText, FolderKanban, Home, Inbox, ListTodo, Menu, PanelLeftClose, PanelLeftOpen, PenLine, Search, Settings, Sparkles, Waypoints, Workflow, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useApi } from "./client";
import { CommandPalette } from "./command-palette";
import { cx, IconButton, Kbd, ToastProvider } from "./ui";

interface NavItem { href: string; label: string; icon: LucideIcon }
const PRIMARY: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/knowledge", label: "Notes", icon: FileText },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/pipeline", label: "Pipeline", icon: Waypoints },
  { href: "/ai", label: "Ask AI", icon: Sparkles },
  { href: "/automations", label: "Automations", icon: Workflow },
];
const MOBILE_MORE = ["/more", "/knowledge", "/projects", "/tasks", "/ai", "/automations", "/settings"];

function isActive(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  if (href === "/more") return MOBILE_MORE.some((r) => path === r || path.startsWith(r + "/"));
  return path === href || path.startsWith(href + "/");
}

const PaletteCtx = createContext<() => void>(() => undefined);
export const useOpenPalette = () => useContext(PaletteCtx);

interface Status { ollama: { ok: boolean } }

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const review = useApi<{ captures: unknown[] }>("/api/captures?status=proposed");
  const recent = useApi<{ notes: { id: string; title: string }[] }>("/api/notes?limit=5");
  const projects = useApi<{ projects: { id: string; name: string }[] }>("/api/projects?status=active");
  const status = useApi<Status>("/api/status");
  const reviewCount = review.data?.captures.length ?? 0;
  const { reload: r1 } = review;
  const { reload: r2 } = recent;
  const { reload: r3 } = projects;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sbos-sidebar") === "collapsed");
    } catch { /* storage unavailable */ }
  }, []);
  // keep sidebar data fresh after navigation (cheap local queries)
  useEffect(() => {
    void r1();
    void r2();
    void r3();
  }, [path, r1, r2, r3]);
  // Ctrl/Cmd+K anywhere
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem("sbos-sidebar", c ? "expanded" : "collapsed"); } catch { /* ignore */ }
      return !c;
    });
  }, []);
  const openPalette = useCallback(() => setPalette(true), []);
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setModKey("⌘");
  }, []);
  const ollama = status.data?.ollama.ok;

  return (
    <PaletteCtx.Provider value={openPalette}>
      <ToastProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">Skip to content</a>
        <div className="flex min-h-dvh">
          {/* ---------- desktop sidebar ---------- */}
          <aside className={cx("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar lg:flex", collapsed ? "w-14" : "w-60")}>
            <div className={cx("flex h-12 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
              <Link href="/" aria-label="Second Brain OS home" className="grid size-7 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
                <Brain size={16} aria-hidden strokeWidth={1.75} />
              </Link>
              {!collapsed && <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">Second Brain OS</span>}
              {!collapsed && <IconButton icon={PanelLeftClose} label="Collapse sidebar" onClick={toggle} />}
            </div>
            {collapsed && <IconButton icon={PanelLeftOpen} label="Expand sidebar" onClick={toggle} className="mx-auto" />}

            <div className={cx("space-y-1.5 px-2 pt-1 pb-2", collapsed && "px-1.5")}>
              <Link href="/capture" title="Capture an idea" className={cx("flex h-8 items-center gap-2 rounded-md border border-line bg-surface2 px-2.5 text-[13px] font-medium hover:bg-hover", collapsed && "justify-center px-0")}>
                <PenLine size={15} aria-hidden strokeWidth={1.75} className="text-accent" />
                {!collapsed && <span className="flex-1">New capture</span>}
              </Link>
              <button type="button" onClick={openPalette} title={`Search (${modKey}+K)`} aria-label={collapsed ? "Search" : undefined} className={cx("flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg", collapsed && "justify-center px-0")}>
                <Search size={15} aria-hidden strokeWidth={1.75} />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Search</span>
                    <span aria-hidden className="flex gap-1"><Kbd>{modKey}</Kbd><Kbd>K</Kbd></span>
                  </>
                )}
              </button>
            </div>

            <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-2 pb-3">
              <div className="space-y-0.5">
                {PRIMARY.map((n) => {
                  const on = isActive(path, n.href);
                  return (
                    <Link key={n.href} href={n.href} title={collapsed ? n.label : undefined} aria-current={on ? "page" : undefined} className={cx("relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px]", collapsed && "justify-center px-0", on ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover/60 hover:text-fg")}>
                      {on && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                      <n.icon size={15} aria-hidden strokeWidth={1.75} className={on ? "text-accent" : ""} />
                      {!collapsed && <span className="flex-1">{n.label}</span>}
                      {!collapsed && n.href === "/inbox" && reviewCount > 0 && <span className="tnum rounded bg-accent/15 px-1.5 text-xs font-medium text-accent" aria-label={`${reviewCount} awaiting review`}>{reviewCount}</span>}
                    </Link>
                  );
                })}
              </div>

              {!collapsed && (projects.data?.projects.length ?? 0) > 0 && (
                <div>
                  <div className="px-2.5 pb-1 text-xs font-medium text-faint">Projects</div>
                  <ul className="space-y-0.5">
                    {projects.data!.projects.slice(0, 6).map((p) => (
                      <li key={p.id}>
                        <Link href={`/projects/${p.id}`} aria-current={path === `/projects/${p.id}` ? "page" : undefined} className={cx("flex h-7 items-center gap-2.5 rounded-md px-2.5 text-[13px] hover:bg-hover/60 hover:text-fg", path === `/projects/${p.id}` ? "bg-hover text-fg" : "text-muted")}>
                          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-faint" />
                          <span className="truncate">{p.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!collapsed && (recent.data?.notes.length ?? 0) > 0 && (
                <div>
                  <div className="px-2.5 pb-1 text-xs font-medium text-faint">Recent notes</div>
                  <ul className="space-y-0.5">
                    {recent.data!.notes.map((n) => (
                      <li key={n.id}>
                        <Link href={`/knowledge/${n.id}`} aria-current={path === `/knowledge/${n.id}` ? "page" : undefined} className={cx("flex h-7 items-center gap-2.5 rounded-md px-2.5 text-[13px] hover:bg-hover/60 hover:text-fg", path === `/knowledge/${n.id}` ? "bg-hover text-fg" : "text-muted")}>
                          <FileText size={13} aria-hidden strokeWidth={1.75} className="shrink-0 text-faint" />
                          <span className="truncate">{n.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </nav>

            <div className={cx("space-y-0.5 border-t border-line p-2", collapsed && "p-1.5")}>
              <div className={cx("flex h-7 items-center gap-2.5 px-2.5 text-xs text-faint", collapsed && "justify-center px-0")} title={ollama === undefined ? "Checking Ollama" : ollama ? "Ollama is reachable" : "Ollama is not reachable: AI features are paused"}>
                <span aria-hidden className={cx("size-2 shrink-0 rounded-full", ollama === undefined ? "bg-faint" : ollama ? "bg-ok" : "bg-danger")} />
                {!collapsed && <span role="status">{ollama === undefined ? "Checking AI…" : ollama ? "Local AI online" : "Local AI offline"}</span>}
              </div>
              <Link href="/settings" title={collapsed ? "Settings" : undefined} aria-current={isActive(path, "/settings") ? "page" : undefined} className={cx("relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px]", collapsed && "justify-center px-0", isActive(path, "/settings") ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover/60 hover:text-fg")}>
                {isActive(path, "/settings") && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                <Settings size={15} aria-hidden strokeWidth={1.75} />
                {!collapsed && "Settings"}
              </Link>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* ---------- mobile top bar ---------- */}
            <header className="safe-top sticky top-0 z-30 flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur lg:hidden">
              <Link href="/" aria-label="Second Brain OS home" className="grid size-7 place-items-center rounded-md bg-accent/15 text-accent">
                <Brain size={16} aria-hidden strokeWidth={1.75} />
              </Link>
              <span className="flex-1 text-[13px] font-semibold tracking-tight">Second Brain OS</span>
              <IconButton icon={Search} label="Search and commands" onClick={openPalette} size={18} />
              <Link href="/more" aria-label="Menu" className="inline-grid size-9 place-items-center rounded-md text-muted hover:bg-hover"><Menu size={18} aria-hidden strokeWidth={1.75} /></Link>
            </header>
            <main id="main" className="min-w-0 flex-1 px-4 pt-5 pb-28 lg:px-10 lg:pt-8 lg:pb-12">{children}</main>
          </div>
        </div>

        {/* ---------- mobile bottom nav ---------- */}
        <nav aria-label="Mobile" className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-end border-t border-line bg-sidebar/95 backdrop-blur lg:hidden">
          {[
            { href: "/", label: "Home", icon: Home },
            { href: "/inbox", label: "Inbox", icon: Inbox },
            { href: "/capture", label: "Capture", icon: PenLine },
            { href: "/search", label: "Search", icon: Search },
            { href: "/more", label: "More", icon: Menu },
          ].map((n) => {
            const on = isActive(path, n.href);
            const fab = n.href === "/capture";
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cx("relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium", on ? "text-accent" : "text-muted")}>
                {fab ? (
                  <span className="-mt-5 grid size-12 place-items-center rounded-full bg-accent text-accent-fg shadow-lg ring-4 ring-bg"><n.icon size={20} aria-hidden strokeWidth={2} /></span>
                ) : (
                  <span className="relative">
                    <n.icon size={20} aria-hidden strokeWidth={1.75} />
                    {n.href === "/inbox" && reviewCount > 0 && <span className="tnum absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 text-accent-fg" aria-label={`${reviewCount} awaiting review`}>{reviewCount}</span>}
                  </span>
                )}
                <span>{n.label}</span>
                {on && !fab && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
              </Link>
            );
          })}
        </nav>

        <CommandPalette open={palette} onClose={() => setPalette(false)} projects={projects.data?.projects ?? []} />
      </ToastProvider>
    </PaletteCtx.Provider>
  );
}
