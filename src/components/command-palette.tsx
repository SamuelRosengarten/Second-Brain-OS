"use client";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, FolderKanban, Home, Inbox, ListTodo, PenLine, Plus, Search, Settings, Sparkles, Workflow, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client";
import { cx, Kbd } from "./ui";

interface Cmd {
  id: string;
  group: "Create" | "Go to" | "Projects" | "Notes" | "Search";
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

/**
 * Keyboard-first command palette (Ctrl/Cmd+K). Every entry is a real route or a real action;
 * note and project entries come from the live database.
 */
export function CommandPalette({ open, onClose, projects }: { open: boolean; onClose: () => void; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setActive(0);
      d.showModal();
      inputRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  // live note title matches
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api<{ notes: { id: string; title: string }[] }>(`/api/notes?q=${encodeURIComponent(term)}&limit=6`)
        .then((r) => !cancelled && setNotes(r.notes))
        .catch(() => !cancelled && setNotes([]));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const go = (href: string) => () => router.push(href);
  const all = useMemo<Cmd[]>(() => {
    const term = q.trim();
    const base: Cmd[] = [
      { id: "capture", group: "Create", label: "Capture an idea", icon: PenLine, keywords: "new capture add inbox", run: go("/capture") },
      { id: "new-note", group: "Create", label: "New note", icon: FileText, keywords: "write create", run: go("/knowledge?new=1") },
      { id: "new-task", group: "Create", label: "New task", icon: ListTodo, keywords: "todo add", run: go("/tasks?new=1") },
      { id: "new-project", group: "Create", label: "New project", icon: Plus, keywords: "create", run: go("/projects?new=1") },
      { id: "home", group: "Go to", label: "Home", hint: "Daily briefing", icon: Home, keywords: "dashboard briefing today", run: go("/") },
      { id: "inbox", group: "Go to", label: "Inbox", icon: Inbox, run: go("/inbox") },
      { id: "notes", group: "Go to", label: "Notes", hint: "Knowledge library", icon: FileText, keywords: "knowledge library", run: go("/knowledge") },
      { id: "tasks", group: "Go to", label: "Tasks", icon: ListTodo, run: go("/tasks") },
      { id: "projects", group: "Go to", label: "Projects", icon: FolderKanban, run: go("/projects") },
      { id: "ai", group: "Go to", label: "Ask AI", hint: "Local chat and Claude handoff", icon: Sparkles, keywords: "chat ollama assistant", run: go("/ai") },
      { id: "automations", group: "Go to", label: "Automations", icon: Workflow, keywords: "jobs", run: go("/automations") },
      { id: "settings", group: "Go to", label: "Settings", hint: "Models, backup, theme", icon: Settings, keywords: "backup model theme sign out", run: go("/settings") },
      ...projects.map<Cmd>((p) => ({ id: `p-${p.id}`, group: "Projects", label: p.name, hint: "Open project", icon: FolderKanban, run: go(`/projects/${p.id}`) })),
    ];
    const low = term.toLowerCase();
    const matched = low ? base.filter((c) => `${c.label} ${c.keywords ?? ""} ${c.hint ?? ""}`.toLowerCase().includes(low)) : base;
    const extra: Cmd[] = [];
    if (term.length >= 2) {
      extra.push(
        { id: "search", group: "Search", label: `Search notes for “${term}”`, hint: "Keyword + semantic", icon: Search, run: go(`/search?q=${encodeURIComponent(term)}`) },
        { id: "ask", group: "Search", label: `Ask AI: “${term}”`, hint: "Uses your library", icon: Sparkles, run: go(`/ai?q=${encodeURIComponent(term)}`) },
        ...notes.map<Cmd>((n) => ({ id: `n-${n.id}`, group: "Notes", label: n.title, hint: "Open note", icon: FileText, run: go(`/knowledge/${n.id}`) })),
      );
    }
    return [...extra.filter((c) => c.group === "Notes"), ...matched, ...extra.filter((c) => c.group === "Search")];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, projects, notes]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (c?: Cmd) => {
    if (!c) return;
    onClose();
    c.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, all.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); choose(all[active]); }
  };

  let lastGroup = "";
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Command palette"
      className="mx-auto mt-[12dvh] w-[min(94vw,38rem)] overflow-hidden rounded-xl border border-line bg-surface2 p-0 shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 focus-within:border-accent">
        <Search size={16} aria-hidden className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={all[active] ? `cmd-${all[active].id}` : undefined}
          aria-label="Search commands and notes"
          placeholder="Search notes, jump to a page, or run a command…"
          className="h-12 w-full border-0 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint lg:text-[14px]"
          autoComplete="off"
          spellCheck={false}
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul id="cmd-list" ref={listRef} role="listbox" className="max-h-[50dvh] overflow-y-auto p-1.5">
        {all.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-muted">No matching commands. Press Enter on “Search notes” to search your library.</li>}
        {all.map((c, i) => {
          const header = c.group !== lastGroup;
          lastGroup = c.group;
          return (
            <li key={c.id} role="presentation">
              {header && <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-faint">{c.group}</div>}
              <button
                id={`cmd-${c.id}`}
                data-idx={i}
                role="option"
                aria-selected={i === active}
                type="button"
                onMouseMove={() => setActive(i)}
                onClick={() => choose(c)}
                className={cx("flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13.5px]", i === active ? "bg-hover text-fg" : "text-muted")}
              >
                <c.icon size={16} aria-hidden strokeWidth={1.75} className={i === active ? "text-accent" : "text-faint"} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="hidden shrink-0 text-xs text-faint sm:block">{c.hint}</span>}
                {i === active && <CornerDownLeft size={13} aria-hidden className="shrink-0 text-faint" />}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs text-faint sm:flex">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
        <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> Open</span>
        <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> Close</span>
      </div>
    </dialog>
  );
}
