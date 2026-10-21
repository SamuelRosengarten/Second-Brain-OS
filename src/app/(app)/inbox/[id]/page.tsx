"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ExternalLink, FileText, Paperclip, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtDate, useApi } from "@/components/client";
import { Badge, Button, ConfirmDialog, ErrorBox, Field, Input, Loading, PageHeader, Textarea, useToast, type Tone } from "@/components/ui";
import type { Capture } from "@/lib/captures";
import type { Project } from "@/lib/projects";

interface Draft { title: string; summary: string; category: string; tags: string; body: string; projectIds: string[]; nextAction: string; makeTask: boolean }
const STATUS_TONE: Record<Capture["status"], Tone> = { new: "neutral", processing: "warn", proposed: "accent", accepted: "ok", dismissed: "neutral", failed: "danger" };
const STATUS_LABEL: Record<Capture["status"], string> = { new: "Unprocessed", processing: "Processing", proposed: "Needs review", accepted: "Saved", dismissed: "Dismissed", failed: "Failed" };

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
    const r = await run(
      "accept",
      () =>
        api<{ note: { id: string } }>(`/api/captures/${id}/accept`, {
          body: {
            title: draft.title, body: draft.body, summary: draft.summary, category: draft.category,
            tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean), project_ids: draft.projectIds,
            tasks: draft.makeTask && draft.nextAction.trim() ? [{ title: draft.nextAction.trim(), project_id: draft.projectIds[0] ?? null }] : [],
          },
        }),
      "Saved as a Markdown note",
    );
    if (r) router.push(`/knowledge/${r.note.id}`);
  };
  const patch = async (body: object, ok: string) => {
    await run("patch", () => api(`/api/captures/${id}`, { method: "PATCH", body }), ok);
    await reload();
  };
  const set = (k: keyof Draft, v: string | boolean | string[]) => setDraft({ ...draft, [k]: v });
  const canAccept = c.status !== "accepted" && c.status !== "processing";
  const edited = content !== c.content;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        crumbs={[{ label: "Inbox", href: "/inbox" }, { label: "Capture" }]}
        title={c.proposal?.title ?? (c.content.replace(/\s+/g, " ").slice(0, 70) || "Capture")}
        actions={
          <>
            <Button variant="ghost" onClick={() => void patch({ archived: !c.archived }, c.archived ? "Restored to inbox" : "Archived")}>
              {c.archived ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
              {c.archived ? "Unarchive" : "Archive"}
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden />Delete…</Button>
          </>
        }
      />
      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2 text-xs text-faint">
        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
        <Badge>{c.kind.replace("_", " ")}</Badge>
        {c.archived && <Badge>archived</Badge>}
        <span className="tnum">Captured {fmtDate(c.created_at)}</span>
      </div>

      <div className="mb-6 space-y-3">
        {c.status === "failed" && <ErrorBox message="AI processing failed. Your original capture is safe." hint={c.error ?? undefined} onRetry={() => void process()} />}
        {c.status === "processing" && (
          <div role="status" className="flex items-center gap-2.5 rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[13px]">
            <Sparkles size={15} aria-hidden className="animate-pulse text-warn" />
            Your local model is working on this. The first reply after idle can take up to a minute while the model loads.
          </div>
        )}
        {c.status === "accepted" && c.note_id && (
          <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3.5 py-2.5 text-[13px]">
            <FileText size={15} aria-hidden className="text-ok" />
            Saved as a note.
            <Link href={`/knowledge/${c.note_id}`} className="font-medium text-accent hover:underline">Open note</Link>
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ---------- original (user content) ---------- */}
        <section className="min-w-0" aria-labelledby="orig">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="orig" className="flex items-center gap-2 text-xs font-semibold tracking-wide text-faint uppercase">
              <FileText size={14} aria-hidden strokeWidth={1.75} />
              Your capture
            </h2>
            {c.status !== "accepted" && edited && (
              <Button size="sm" variant="primary" loading={busy === "patch"} onClick={() => void patch({ content }, "Capture updated")}>Save edit</Button>
            )}
          </div>
          {c.url && (
            <p className="mb-2 flex items-center gap-1.5 text-[13px]">
              <ExternalLink size={13} aria-hidden className="shrink-0 text-faint" />
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-accent hover:underline">{c.url}</a>
            </p>
          )}
          <Textarea aria-label="Capture content" rows={10} value={content} onChange={(e) => setContent(e.target.value)} disabled={c.status === "accepted"} className="leading-relaxed" />
          {content !== c.original_content && <p className="mt-1.5 text-xs text-faint">Edited. The untouched original is kept separately.</p>}
          {c.attachments.length > 0 && (
            <ul className="mt-3 space-y-2">
              {c.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-3 text-[13px]">
                  {a.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/attachments/${a.id}?inline=1`} alt={a.filename} className="size-14 rounded-md border border-line object-cover" />
                  ) : (
                    <Paperclip size={14} aria-hidden className="text-faint" />
                  )}
                  <a href={`/api/attachments/${a.id}`} className="text-accent hover:underline">{a.filename}</a>
                  <span className="tnum text-xs text-faint">{(a.size / 1024).toFixed(0)} KB</span>
                </li>
              ))}
            </ul>
          )}
          {(c.status === "new" || c.status === "dismissed") && (
            <div className="mt-4">
              <Button variant="primary" loading={busy === "process"} onClick={() => void process()}>
                <Sparkles size={14} aria-hidden />
                Process with local AI
              </Button>
            </div>
          )}
        </section>

        {/* ---------- AI suggestion / note draft ---------- */}
        {c.status !== "accepted" && (
          <section className={`min-w-0 rounded-lg border bg-surface p-4 ${c.proposal ? "border-accent/35" : "border-line"}`} aria-labelledby="ai">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="ai" className={`flex items-center gap-2 text-xs font-semibold tracking-wide uppercase ${c.proposal ? "text-accent" : "text-faint"}`}>
                {c.proposal ? <Sparkles size={14} aria-hidden strokeWidth={1.75} /> : <FileText size={14} aria-hidden strokeWidth={1.75} />}
                {c.proposal ? "AI suggestion · review before saving" : "Save as note"}
              </h2>
              {c.status === "proposed" && (
                <Button size="sm" loading={busy === "process"} onClick={() => void process()}><RotateCcw size={13} aria-hidden />Re-run AI</Button>
              )}
            </div>
            {!c.proposal && <p className="mb-3 text-[13px] text-muted">No AI suggestion. You can still turn this capture into a note by hand.</p>}
            {c.proposal && (
              <div className="mb-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.proposal.confidence === "high" ? "ok" : c.proposal.confidence === "low" ? "warn" : "neutral"}>Model confidence: {c.proposal.confidence}</Badge>
                  {c.model && <Badge>{c.model}</Badge>}
                </div>
                <p className="text-xs text-faint">Generated by a local model. It can be wrong or incomplete, and it is only a suggestion until you save it. Everything below is editable.</p>
                {c.proposal.uncertainty && (
                  <p className="rounded-md bg-warn/10 px-3 py-2 text-[13px]"><strong className="font-medium">Uncertainty: </strong>{c.proposal.uncertainty}</p>
                )}
              </div>
            )}
            <div className="space-y-4">
              <Field label="Title"><Input value={draft.title} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label="Summary"><Textarea rows={2} value={draft.summary} onChange={(e) => set("summary", e.target.value)} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category"><Input value={draft.category} onChange={(e) => set("category", e.target.value)} /></Field>
                <Field label="Tags" hint="Comma separated"><Input value={draft.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
              </div>
              <Field label="Note body (Markdown)"><Textarea rows={9} className="font-mono text-[13px]" value={draft.body} onChange={(e) => set("body", e.target.value)} /></Field>
              {c.proposal && c.proposal.open_questions.length > 0 && (
                <div className="text-[13px]">
                  <p className="font-medium">Open questions</p>
                  <ul className="mt-1 list-disc pl-5 text-muted">{c.proposal.open_questions.map((q) => <li key={q}>{q}</li>)}</ul>
                </div>
              )}
              {(projects.data?.projects.length ?? 0) > 0 && (
                <fieldset>
                  <legend className="mb-1.5 text-[13px] font-medium text-muted">Link to projects</legend>
                  <div className="flex flex-wrap gap-2">
                    {projects.data!.projects.filter((p) => p.status !== "archived").map((p) => {
                      const on = draft.projectIds.includes(p.id);
                      return (
                        <label key={p.id} className={`cursor-pointer rounded-md border px-2.5 py-1 text-[13px] focus-within:outline-2 focus-within:outline-accent ${on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-fg"}`}>
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => set("projectIds", on ? draft.projectIds.filter((x) => x !== p.id) : [...draft.projectIds, p.id])} />
                          {p.name}{c.proposal?.related_projects.includes(p.name) ? " (suggested)" : ""}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <Field label="Suggested next action" hint="Tick the box to create a task from it when you save. Nothing is created without your approval.">
                <Input value={draft.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={draft.makeTask} onChange={(e) => set("makeTask", e.target.checked)} disabled={!draft.nextAction.trim()} />
                Also create a task from this action
              </label>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" loading={busy === "accept"} disabled={!canAccept || !draft.title.trim()} onClick={() => void accept()}>Save as note</Button>
              {c.status === "proposed" && <Button onClick={() => void patch({ status: "dismissed" }, "Suggestion dismissed")}>Dismiss suggestion</Button>}
            </div>
          </section>
        )}
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
