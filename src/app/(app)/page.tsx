"use client";
import Link from "next/link";
import { CaptureForm } from "@/components/capture-form";
import { api, fmtDate, useApi } from "@/components/client";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorBox, Loading, PageHeader, useToast } from "@/components/ui";
import type { Briefing } from "@/lib/briefing";

interface Status {
  ollama: { ok: boolean; error?: string };
  chatModel: { name: string; installed: boolean };
  embedModel: { name: string; installed: boolean; total: number; embedded: number };
}

function StatusBanners() {
  const { data } = useApi<Status>("/api/status");
  if (!data) return null;
  const items: { text: string; hint?: string }[] = [];
  if (!data.ollama.ok) items.push({ text: "Ollama is not reachable, so AI features are paused. Captures and search still work.", hint: "Start Ollama from the system tray, then reload." });
  else {
    if (!data.chatModel.installed) items.push({ text: `Chat model “${data.chatModel.name}” is not installed.`, hint: `ollama pull ${data.chatModel.name}` });
    if (!data.embedModel.installed) items.push({ text: `Semantic search is off: embedding model “${data.embedModel.name}” is not installed (search uses keywords meanwhile).`, hint: `ollama pull ${data.embedModel.name}   (about 274 MB)` });
  }
  if (!items.length) return null;
  return (
    <div className="mb-6 space-y-2">
      {items.map((i) => (
        <div key={i.text} className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <p>{i.text}</p>
          {i.hint && <code className="mt-1 block font-mono text-xs text-muted">{i.hint}</code>}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, href, tone }: { label: string; value: number; href: string; tone?: "danger" | "accent" }) {
  return (
    <Link href={href} className="rounded-xl border border-line bg-surface p-4 hover:border-muted">
      <div className={`text-2xl font-semibold ${tone === "danger" && value ? "text-danger" : tone === "accent" && value ? "text-accent" : ""}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </Link>
  );
}

export default function HomePage() {
  const { data: b, error, loading, reload } = useApi<Briefing>("/api/briefing");
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

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Home"
        subtitle={b ? `Briefing for ${b.today}, generated ${fmtDate(b.generatedAt)} from your local data` : "Daily briefing"}
        actions={<Button size="sm" onClick={() => void reload()}>Refresh</Button>}
      />
      <StatusBanners />
      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !b && <Loading />}
      {b && (
        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Open tasks" value={b.counts.openTasks} href="/tasks?status=open" />
            <Stat label="Overdue" value={b.counts.overdue} href="/tasks?due=overdue" tone="danger" />
            <Stat label="Due today" value={b.counts.dueToday} href="/tasks?due=today" tone="accent" />
            <Stat label="Awaiting AI review" value={b.counts.awaitingReview} href="/inbox?status=proposed" tone="accent" />
          </section>

          <Card>
            <CardTitle>Needs attention</CardTitle>
            <ul className="space-y-1 text-sm">
              {b.notes.map((n) => (
                <li key={n} className="text-muted first:text-fg">{n}</li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="hidden md:block">
              <CardTitle>Quick capture</CardTitle>
              <CaptureForm compact onSaved={() => void reload()} />
            </Card>

            <Card>
              <CardTitle action={<Link href="/tasks" className="text-xs text-accent hover:underline">All tasks</Link>}>Tasks</CardTitle>
              {[...b.overdue, ...b.dueToday, ...b.dueSoon].length === 0 ? (
                <p className="text-sm text-muted">No tasks with a due date in the next 7 days.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {[...b.overdue.map((t) => ({ t, tag: "overdue" })), ...b.dueToday.map((t) => ({ t, tag: "today" })), ...b.dueSoon.map((t) => ({ t, tag: "soon" }))].map(({ t, tag }) => (
                    <li key={t.id} className="flex items-center gap-3 py-2">
                      <button aria-label={`Complete ${t.title}`} onClick={() => void complete(t.id)} className="size-5 shrink-0 rounded-full border border-muted hover:border-accent" />
                      <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                      <Badge tone={tag === "overdue" ? "danger" : tag === "today" ? "accent" : "neutral"}>{tag === "soon" ? t.due_date : tag}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle action={<Link href="/inbox" className="text-xs text-accent hover:underline">Inbox</Link>}>Recent captures</CardTitle>
              {b.recentCaptures.length === 0 ? (
                <EmptyState title="Nothing captured yet">Use Quick capture to save your first idea. It is stored before any AI runs.</EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {b.recentCaptures.map((c) => (
                    <li key={c.id}>
                      <Link href={`/inbox/${c.id}`} className="flex items-center gap-3 py-2 hover:text-accent">
                        <span className="min-w-0 flex-1 truncate text-sm">{c.preview}</span>
                        <Badge tone={c.status === "failed" ? "danger" : c.status === "proposed" ? "accent" : "neutral"}>{c.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle action={<Link href="/knowledge" className="text-xs text-accent hover:underline">Library</Link>}>Recently edited notes</CardTitle>
              {b.recentNotes.length === 0 ? (
                <p className="text-sm text-muted">No notes yet. Accept a processed capture or import documents to build your library.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {b.recentNotes.map((n) => (
                    <li key={n.id}>
                      <Link href={`/knowledge/${n.id}`} className="flex justify-between gap-3 py-2 text-sm hover:text-accent">
                        <span className="truncate">{n.title}</span>
                        <span className="shrink-0 text-xs text-muted">{fmtDate(n.updated_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="lg:col-span-2">
              <CardTitle action={<Link href="/projects" className="text-xs text-accent hover:underline">Projects</Link>}>Active projects</CardTitle>
              {b.activeProjects.length === 0 ? (
                <p className="text-sm text-muted">No active projects. Create one under Projects to group tasks and notes.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {b.activeProjects.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm hover:border-muted">
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-muted">{p.open_tasks} open{p.target_date ? ` · ${p.target_date}` : ""}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
