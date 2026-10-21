"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FolderKanban, Plus } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { api, useApi } from "@/components/client";
import { Badge, Button, Dialog, EmptyState, ErrorBox, Field, Input, ListSkeleton, PageHeader, rowClass, RowList, Textarea, useToast } from "@/components/ui";
import type { Project } from "@/lib/projects";

type Row = Project & { open_tasks: number; note_count: number };
const tone = (s: string) => (s === "active" ? "ok" : s === "paused" ? "warn" : "neutral") as "ok" | "warn" | "neutral";

function Projects() {
  const toast = useToast();
  const sp = useSearchParams();
  const { data, error, loading, reload } = useApi<{ projects: Row[] }>("/api/projects");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", description: "", goals: "", target_date: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sp.get("new") === "1") setOpen(true);
  }, [sp]);

  async function create() {
    setBusy(true);
    try {
      await api("/api/projects", { body: { name: f.name, description: f.description, goals: f.goals, target_date: f.target_date || null } });
      toast("Project created");
      setOpen(false);
      setF({ name: "", description: "", goals: "", target_date: "" });
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Projects" subtitle="Group tasks and notes around an outcome." actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={14} aria-hidden />New project</Button>} />
      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !data && <ListSkeleton rows={3} />}
      {data && data.projects.length === 0 && (
        <EmptyState icon={FolderKanban} title="No projects yet" action={<Button variant="primary" onClick={() => setOpen(true)}>Create your first project</Button>}>
          A project has a goal, a status, tasks and linked notes. Keep it light: one line of goals is enough to start.
        </EmptyState>
      )}
      {(data?.projects.length ?? 0) > 0 && (
        <RowList>
          {data!.projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className={`${rowClass} items-start`}>
                <FolderKanban size={16} aria-hidden strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{p.name}</p>
                  {p.description && <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{p.description}</p>}
                  <p className="tnum mt-1 text-xs text-faint">{p.open_tasks} open task{p.open_tasks === 1 ? "" : "s"} · {p.note_count} note{p.note_count === 1 ? "" : "s"}{p.target_date ? ` · target ${p.target_date}` : ""}</p>
                </div>
                <Badge tone={tone(p.status)}>{p.status}</Badge>
              </Link>
            </li>
          ))}
        </RowList>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New project" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={() => void create()}>Create</Button></>}>
        <div className="space-y-3 text-fg">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Goals"><Textarea rows={2} value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} /></Field>
          <Field label="Target date (optional)"><Input type="date" value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <Projects />
    </Suspense>
  );
}
