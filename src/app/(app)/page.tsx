"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, FileText, FolderKanban, Inbox, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { QuickCapture } from "@/components/quick-capture";
import { api, fmtDate, localToday, useApi } from "@/components/client";
import { Badge, EmptyState, ErrorBox, IconButton, ListSkeleton, rowClass, RowList, Section, useToast } from "@/components/ui";
import type { Briefing } from "@/lib/briefing";

interface Status {
  ollama: { ok: boolean; error?: string };
  chatModel: { name: string; installed: boolean };
  embedModel: { name: string; installed: boolean; total: number; embedded: number };
}

function Greeting() {
  const [g, setG] = useState({ hello: "Welcome back", date: "" });
  useEffect(() => {
    const h = new Date().getHours();
    setG({
      hello: h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening",
      date: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    });
  }, []);
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{g.hello}</h1>
      <p className="mt-0.5 min-h-5 text-[13px] text-muted">{g.date}</p>
    </div>
  );
}

function SystemStatus() {
  const { data, error } = useApi<Status>("/api/status");
  if (error) return null;
  const items: { ok: boolean | null; label: string; hint?: string }[] = data
    ? [
        { ok: data.ollama.ok, label: data.ollama.ok ? "Ollama is reachable" : "Ollama is offline", hint: data.ollama.ok ? undefined : "Start Ollama. Captures, notes and keyword search still work." },
        ...(data.ollama.ok
          ? [
              { ok: data.chatModel.installed, label: `Chat model ${data.chatModel.name}`, hint: data.chatModel.installed ? undefined : `ollama pull ${data.chatModel.name}` },
              data.embedModel.installed
                ? { ok: data.embedModel.embedded >= data.embedModel.total, label: `Semantic index ${data.embedModel.embedded}/${data.embedModel.total}`, hint: data.embedModel.embedded < data.embedModel.total ? "Build it from Notes" : undefined }
                : { ok: false, label: "Semantic search is off", hint: `ollama pull ${data.embedModel.name}` },
            ]
          : []),
      ]
    : [{ ok: null, label: "Checking system…" }];
  return (
    <Section title="System">
      <ul className="space-y-2 text-[13px]">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2.5">
            <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${i.ok === null ? "bg-faint" : i.ok ? "bg-ok" : "bg-warn"}`} />
            <span className="min-w-0">
              <span className="block">{i.label}<span className="sr-only">{i.ok === null ? "" : i.ok ? ": ok" : ": needs attention"}</span></span>
              {i.hint && <code className="block font-mono text-xs break-words text-faint">{i.hint}</code>}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function HomePage() {
  const { data: b, error, loading, reload } = useApi<Briefing>(`/api/briefing?today=${localToday()}`);
  const toast = useToast();

  async function complete(id: string) {
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body: { status: "done" } });
      toast("Task completed");
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  const tasks = b ? [...b.overdue.map((t) => ({ t, tag: "overdue" as const })), ...b.dueToday.map((t) => ({ t, tag: "today" as const })), ...b.dueSoon.map((t) => ({ t, tag: "soon" as const }))] : [];

  return (
    <div className="mx-auto max-w-6xl">
      <Greeting />
      <div className="mb-8"><QuickCapture onSaved={() => void reload()} /></div>

      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !b && <ListSkeleton rows={4} />}

      {b && (
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-8">
            <Section
              title="Briefing"
              icon={Sparkles}
              action={
                <span className="flex items-center gap-1 text-xs text-faint">
                  <span className="tnum">Generated {fmtDate(b.generatedAt)} from local data</span>
                  <IconButton icon={RefreshCw} label="Refresh briefing" onClick={() => void reload()} />
                </span>
              }
            >
              <ul className="space-y-1.5 rounded-lg border border-line bg-surface p-4 text-[13.5px]">
                {b.notes.map((n, i) => (
                  <li key={n} className={i === b.notes.length - 1 ? "text-faint" : "text-fg"}>{n}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-faint">
                <span className="tnum">{b.counts.openTasks}</span> open · <span className="tnum">{b.counts.overdue}</span> overdue · <span className="tnum">{b.counts.dueToday}</span> due today · <span className="tnum">{b.counts.activeProjects}</span> active project{b.counts.activeProjects === 1 ? "" : "s"}. Counts are computed from your database, not generated by a model.
              </p>
            </Section>

            <Section title="Today" icon={CheckCircle2} action={<Link href="/tasks" className="text-xs text-muted hover:text-fg">All tasks</Link>}>
              {tasks.length === 0 ? (
                <EmptyState title="Nothing due in the next 7 days" icon={CheckCircle2}>Tasks with a due date show up here. Add one from Tasks.</EmptyState>
              ) : (
                <RowList>
                  {tasks.map(({ t, tag }) => (
                    <li key={t.id} className={rowClass}>
                      <button aria-label={`Complete ${t.title}`} onClick={() => void complete(t.id)} className="grid size-10 shrink-0 place-items-center rounded-full text-faint hover:text-ok lg:size-6">
                        <Circle size={18} aria-hidden strokeWidth={1.5} />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{t.title}</span>
                      {tag === "overdue" && <Badge tone="danger" icon={AlertTriangle}>Overdue · <span className="tnum">{t.due_date}</span></Badge>}
                      {tag === "today" && <Badge tone="accent">Today</Badge>}
                      {tag === "soon" && <span className="tnum text-xs text-faint">{t.due_date}</span>}
                    </li>
                  ))}
                </RowList>
              )}
            </Section>

            <Section title="Needs your review" icon={Inbox} action={<Link href="/inbox" className="text-xs text-muted hover:text-fg">Open inbox</Link>}>
              {b.awaitingReview.length === 0 && b.recentCaptures.length === 0 ? (
                <EmptyState title="Your inbox is empty" icon={Inbox}>Capture something above. It is saved immediately; your local AI can then propose a title, summary and tags for you to review.</EmptyState>
              ) : b.awaitingReview.length === 0 ? (
                <p className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-muted">No AI suggestions are waiting for review.</p>
              ) : (
                <RowList>
                  {b.awaitingReview.map((c) => (
                    <li key={c.id}>
                      <Link href={`/inbox/${c.id}`} className={rowClass}>
                        <Sparkles size={15} aria-hidden className="shrink-0 text-accent" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.title}</span>
                        <Badge tone="accent">Review</Badge>
                      </Link>
                    </li>
                  ))}
                </RowList>
              )}
            </Section>
          </div>

          <aside className="min-w-0 space-y-8">
            <Section title="Recent notes" icon={FileText} action={<Link href="/knowledge" className="text-xs text-muted hover:text-fg">All notes</Link>}>
              {b.recentNotes.length === 0 ? (
                <p className="text-[13px] text-muted">No notes yet. Accept a processed capture, import files, or write one from Notes.</p>
              ) : (
                <ul className="-mx-2">
                  {b.recentNotes.map((n) => (
                    <li key={n.id}>
                      <Link href={`/knowledge/${n.id}`} className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover/60">
                        <span className="truncate">{n.title}</span>
                        <span className="tnum shrink-0 text-xs text-faint">{new Date(n.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Active projects" icon={FolderKanban} action={<Link href="/projects" className="text-xs text-muted hover:text-fg">All projects</Link>}>
              {b.activeProjects.length === 0 ? (
                <p className="text-[13px] text-muted">No active projects. Create one under Projects to group tasks and notes.</p>
              ) : (
                <ul className="-mx-2">
                  {b.activeProjects.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover/60">
                        <span className="truncate">{p.name}</span>
                        <span className="tnum shrink-0 text-xs text-faint">{p.open_tasks} open{p.target_date ? ` · ${p.target_date}` : ""}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <SystemStatus />
            {b.counts.failed > 0 && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px]">
                <p className="font-medium text-danger">{b.counts.failed} capture{b.counts.failed === 1 ? "" : "s"} failed AI processing</p>
                <Link href="/inbox" className="mt-1 inline-block text-xs text-muted underline hover:text-fg">Review and retry</Link>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
