"use client";
import { useState } from "react";
import { api, fmtDate, useApi } from "@/components/client";
import { Badge, Button, Card, CardTitle, EmptyState, ErrorBox, PageHeader, useToast } from "@/components/ui";

interface Run { id: string; job: string; status: "running" | "ok" | "error"; detail: string; started_at: string; finished_at: string | null }

const JOBS = [
  { id: "process-pending", name: "Process unprocessed captures", trigger: "Manual", input: "All inbox captures with status “Unprocessed” (max 50)", does: "Runs the local model on each and stores a proposal for your review. Never saves notes or tasks by itself." },
  { id: "build-embeddings", name: "Build semantic index", trigger: "Manual", input: "Library passages without an embedding", does: "Calls the local embedding model so search can match by meaning. Requires the embedding model to be installed." },
  { id: "reindex-vault", name: "Reindex vault from Markdown files", trigger: "Manual", input: "The .md files in your vault folder", does: "Picks up files you added or edited outside the app and rebuilds the search index. Never modifies or deletes your files." },
] as const;

export default function AutomationsPage() {
  const toast = useToast();
  const runs = useApi<{ runs: Run[] }>("/api/jobs");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(job: string) {
    setBusy(job);
    try {
      const r = await api<{ run: Run }>("/api/jobs", { body: { job } });
      toast(r.run.status === "ok" ? "Job finished" : "Job finished with errors", r.run.status === "ok" ? "ok" : "danger");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(null);
      void runs.reload();
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Automations" subtitle="Small, fixed jobs you start yourself. No scheduled or autonomous actions in this release." />
      <div className="grid gap-4 lg:grid-cols-3">
        {JOBS.map((j) => (
          <Card key={j.id} className="flex flex-col">
            <h2 className="font-medium">{j.name}</h2>
            <dl className="mt-2 flex-1 space-y-1 text-xs text-muted">
              <div><dt className="inline font-medium text-fg">Trigger: </dt><dd className="inline">{j.trigger}</dd></div>
              <div><dt className="inline font-medium text-fg">Input: </dt><dd className="inline">{j.input}</dd></div>
              <div><dt className="inline font-medium text-fg">Effect: </dt><dd className="inline">{j.does}</dd></div>
            </dl>
            <Button className="mt-4" variant="primary" loading={busy === j.id} onClick={() => void run(j.id)}>Run now</Button>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle action={<Button size="sm" variant="ghost" onClick={() => void runs.reload()}>Refresh</Button>}>Run history</CardTitle>
        {runs.error && <ErrorBox message={runs.error} />}
        {runs.data?.runs.length === 0 && <EmptyState title="No runs yet">Run a job above. Results and errors appear here; failed jobs can simply be run again.</EmptyState>}
        <ul className="divide-y divide-line">
          {runs.data?.runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Badge tone={r.status === "ok" ? "ok" : r.status === "error" ? "danger" : "warn"}>{r.status}</Badge>
              <span className="font-medium">{JOBS.find((j) => j.id === r.job)?.name ?? r.job}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{r.detail}</span>
              <span className="text-xs text-muted">{fmtDate(r.started_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted">Later phases (n8n, scheduled briefings, folder summaries) are listed in docs/ROADMAP.md and will require explicit opt-in and approval steps.</p>
    </div>
  );
}
