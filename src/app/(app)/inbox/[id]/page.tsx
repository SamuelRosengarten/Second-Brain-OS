"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtDate, useApi } from "@/components/client";
import { Badge, Button, Card, CardTitle, ConfirmDialog, ErrorBox, Field, Input, Loading, Textarea, useToast } from "@/components/ui";
import type { Capture } from "@/lib/captures";
import type { Project } from "@/lib/projects";

interface Draft { title: string; summary: string; category: string; tags: string; body: string; projectIds: string[]; nextAction: string; makeTask: boolean }

export default function CaptureDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ capture: Capture }>(`/api/captures/${id}`);
  const projects = useApi<{ projects: Project[] }>("/api/projects");
  const c = data?.capture;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Seed the editable draft from the AI proposal (or from the raw content for manual saving).
  useEffect(() => {
    if (!c) return;
    setContent(c.content);
    const p = c.proposal;
    const matched = (projects.data?.projects ?? []).filter((pr) => p?.related_projects.includes(pr.name)).map((pr) => pr.id);
    setDraft({
      title: p?.title ?? c.content.split("\n")[0].slice(0, 80),
      summary: p?.summary ?? "",
      category: p?.category ?? "",
      tags: p?.tags.join(", ") ?? "",
      body: p?.note_markdown ?? c.content,
      projectIds: matched,
      nextAction: p?.next_action ?? "",
      makeTask: false,
    });
  }, [c?.id, c?.status, c?.updated_at, projects.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while the model is working.
  useEffect(() => {
    if (c?.status !== "processing") return;
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [c?.status, reload]);

  async function run<T>(label: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(label);
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !c) return <Loading />;
  if (error || !c || !draft) return <ErrorBox message={error ?? "Capture not found"} onRetry={() => void reload()} />;

  const process = async () => {
    await run("process", () => api(`/api/captures/${id}/process`, { body: {} }));
    await reload();
  };
  const accept = async () => {
    const r = await run("accept", () =>
      api<{ note: { id: string } }>(`/api/captures/${id}/accept`, {
        body: {
          title: draft.title, body: draft.body, summary: draft.summary, category: draft.category,
          tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean), project_ids: draft.projectIds,
          tasks: draft.makeTask && draft.nextAction.trim() ? [{ title: draft.nextAction.trim(), project_id: draft.projectIds[0] ?? null }] : [],
        },
      }),
    "Saved as a Markdown note");
    if (r) router.push(`/knowledge/${r.note.id}`);
  };
  const patch = async (body: object, ok: string) => {
    await run("patch", () => api(`/api/captures/${id}`, { method: "PATCH", body }), ok);
    await reload();
  };
  const set = (k: keyof Draft, v: string | boolean | string[]) => setDraft({ ...draft, [k]: v });
  const canAccept = c.status !== "accepted" && c.status !== "processing";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/inbox" className="text-sm text-muted hover:text-fg">← Inbox</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Capture</h1>
          <Badge tone={c.status === "failed" ? "danger" : c.status === "proposed" ? "accent" : c.status === "accepted" ? "ok" : c.status === "processing" ? "warn" : "neutral"}>{c.status}</Badge>
          <Badge>{c.kind.replace("_", " ")}</Badge>
          {c.archived && <Badge>archived</Badge>}
          <span className="text-xs text-muted">{fmtDate(c.created_at)}</span>
        </div>
      </div>

      {c.status === "failed" && (
        <ErrorBox message="AI processing failed. Your original capture is safe." hint={c.error ?? undefined} onRetry={() => void process()} />
      )}
      {c.status === "processing" && <Card><Loading label="Your local model is working on this" /></Card>}
      {c.status === "accepted" && c.note_id && (
        <Card><p className="text-sm">Saved as a note. <Link href={`/knowledge/${c.note_id}`} className="text-accent hover:underline">Open note →</Link></p></Card>
      )}

      <Card>
        <CardTitle action={c.status !== "accepted" && content !== c.content ? <Button size="sm" variant="primary" loading={busy === "patch"} onClick={() => void patch({ content }, "Capture updated")}>Save edit</Button> : undefined}>
          Your capture
        </CardTitle>
        {c.url && <p className="mb-2 text-sm"><a href={c.url} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{c.url}</a></p>}
        <Textarea aria-label="Capture content" rows={6} value={content} onChange={(e) => setContent(e.target.value)} disabled={c.status === "accepted"} />
        {content !== c.original_content && <p className="mt-2 text-xs text-muted">Edited. The untouched original is kept separately.</p>}
        {c.attachments.length > 0 && (
          <ul className="mt-3 space-y-2">
            {c.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-sm">
                {a.mime.startsWith("image/") && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/attachments/${a.id}?inline=1`} alt={a.filename} className="h-16 w-16 rounded-lg border border-line object-cover" />
                )}
                <a href={`/api/attachments/${a.id}`} className="text-accent hover:underline">{a.filename}</a>
                <span className="text-xs text-muted">{(a.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        )}
        {(c.status === "new" || c.status === "dismissed") && (
          <div className="mt-4"><Button variant="primary" loading={busy === "process"} onClick={() => void process()}>Process with local AI</Button></div>
        )}
      </Card>

      {c.status !== "accepted" && (
        <Card>
          <CardTitle action={c.status === "proposed" ? <Button size="sm" loading={busy === "process"} onClick={() => void process()}>Re-run AI</Button> : undefined}>
            {c.proposal ? "AI proposal — review and edit" : "Save as note"}
          </CardTitle>
          {!c.proposal && <p className="mb-3 text-sm text-muted">No AI proposal. You can still turn this capture into a note by hand.</p>}
          {c.proposal && (
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <Badge tone={c.proposal.confidence === "high" ? "ok" : c.proposal.confidence === "low" ? "warn" : "neutral"}>AI confidence: {c.proposal.confidence}</Badge>
              {c.model && <Badge>{c.model}</Badge>}
              <span className="text-muted">Generated by a model. It may be wrong; this is a suggestion until you save it.</span>
            </div>
          )}
          {c.proposal?.uncertainty && <p className="mb-4 rounded-lg bg-warn/10 px-3 py-2 text-sm"><strong className="font-medium">Uncertainty: </strong>{c.proposal.uncertainty}</p>}
          <div className="space-y-4">
            <Field label="Title"><Input value={draft.title} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="Summary"><Textarea rows={2} value={draft.summary} onChange={(e) => set("summary", e.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category"><Input value={draft.category} onChange={(e) => set("category", e.target.value)} /></Field>
              <Field label="Tags" hint="Comma separated"><Input value={draft.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
            </div>
            <Field label="Note body (Markdown)"><Textarea rows={10} className="font-mono text-sm" value={draft.body} onChange={(e) => set("body", e.target.value)} /></Field>
            {c.proposal && c.proposal.open_questions.length > 0 && (
              <div className="text-sm">
                <p className="font-medium">Open questions</p>
                <ul className="mt-1 list-disc pl-5 text-muted">{c.proposal.open_questions.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
            )}
            {(projects.data?.projects.length ?? 0) > 0 && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Link to projects</legend>
                <div className="flex flex-wrap gap-2">
                  {projects.data!.projects.filter((p) => p.status !== "archived").map((p) => {
                    const on = draft.projectIds.includes(p.id);
                    return (
                      <label key={p.id} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"}`}>
                        <input type="checkbox" className="sr-only" checked={on} onChange={() => set("projectIds", on ? draft.projectIds.filter((x) => x !== p.id) : [...draft.projectIds, p.id])} />
                        {p.name}{c.proposal?.related_projects.includes(p.name) ? " ✦" : ""}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <Field label="Suggested next action" hint="Tick the box to create a task from it when you save. Nothing is created without your approval.">
              <Input value={draft.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={draft.makeTask} onChange={(e) => set("makeTask", e.target.checked)} disabled={!draft.nextAction.trim()} />
              Also create a task from this action
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === "accept"} disabled={!canAccept || !draft.title.trim()} onClick={() => void accept()}>Save as note</Button>
            {c.status === "proposed" && <Button onClick={() => void patch({ status: "dismissed" }, "Proposal dismissed")}>Dismiss proposal</Button>}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button onClick={() => void patch({ archived: !c.archived }, c.archived ? "Restored to inbox" : "Archived")}>{c.archived ? "Unarchive" : "Archive"}</Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete…</Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this capture?"
        message="The capture and its processing history will be removed. Attached files are moved to attachments/.trash on disk. Notes already created from it are kept."
        busy={busy === "delete"}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const r = await run("delete", () => api(`/api/captures/${id}`, { method: "DELETE" }), "Capture deleted");
          setConfirmDelete(false);
          if (r) router.push("/inbox");
        }}
      />
    </div>
  );
}
