"use client";
import { useState } from "react";
import { api, useApi } from "./client";
import { Button, Card, CardTitle, ErrorBox, Field, Input, Select, Textarea, useToast } from "./ui";

/** Build a Markdown package for Claude, copy it yourself, then paste Claude's answer back as a note. Nothing is ever sent automatically. */
export function ClaudeHandoff() {
  const toast = useToast();
  const notes = useApi<{ notes: { id: string; title: string }[] }>("/api/notes?limit=500");
  const projects = useApi<{ projects: { id: string; name: string }[] }>("/api/projects");
  const [sel, setSel] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [question, setQuestion] = useState("");
  const [pkg, setPkg] = useState<{ markdown: string; included: { id: string; title: string }[]; chars: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState({ title: "", body: "" });

  async function build() {
    setError(null);
    try {
      setPkg(await api("/api/claude/package", { body: { noteIds: sel, projectId: projectId || undefined, question } }));
    } catch (e) {
      setPkg(null);
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  async function copy() {
    if (!pkg) return;
    try {
      await navigator.clipboard.writeText(pkg.markdown);
      toast("Copied. Paste it into Claude.");
    } catch {
      toast("Clipboard unavailable (needs HTTPS or localhost). Use Download instead.", "danger");
    }
  }
  function download() {
    if (!pkg) return;
    const url = URL.createObjectURL(new Blob([pkg.markdown], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "context-package.md" });
    a.click();
    URL.revokeObjectURL(url);
  }
  async function saveReply() {
    try {
      const r = await api<{ note: { id: string } }>("/api/notes", { body: { title: reply.title, body: reply.body, source_type: "claude", source_ref: "Claude (pasted by user)", tags: ["claude"] } });
      toast("Saved as a note");
      window.location.href = `/knowledge/${r.note.id}`;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-4">
        <CardTitle>1. Choose what to share</CardTitle>
        <p className="text-sm text-muted">Nothing leaves this PC unless you copy or download the package below and paste it into Claude yourself.</p>
        <Field label="Project (includes its goals, tasks and linked notes)">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">None</option>
            {projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Notes</legend>
          <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-line p-2">
            {notes.data?.notes.length === 0 && <p className="text-sm text-muted">No notes yet.</p>}
            {notes.data?.notes.map((n) => (
              <label key={n.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={sel.includes(n.id)} onChange={() => setSel(sel.includes(n.id) ? sel.filter((x) => x !== n.id) : [...sel, n.id])} />
                <span className="truncate">{n.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Your question"><Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
        {error && <ErrorBox message={error} />}
        <Button variant="primary" disabled={!sel.length && !projectId} onClick={() => void build()}>Build package</Button>
      </Card>

      <div className="space-y-6">
        <Card className="space-y-3">
          <CardTitle>2. Review and send</CardTitle>
          {!pkg ? <p className="text-sm text-muted">Build a package to review exactly what would be shared.</p> : (
            <>
              <p className="text-xs text-muted">{pkg.included.length} note(s) · {pkg.chars.toLocaleString()} characters</p>
              <Textarea aria-label="Context package preview" readOnly rows={12} className="font-mono text-xs" value={pkg.markdown} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void copy()}>Copy to clipboard</Button>
                <Button onClick={download}>Download .md</Button>
                <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg border border-line bg-surface2 px-4 text-sm font-medium hover:border-muted">Open Claude ↗</a>
              </div>
            </>
          )}
        </Card>
        <Card className="space-y-3">
          <CardTitle>3. Save Claude&apos;s answer</CardTitle>
          <Field label="Title"><Input value={reply.title} onChange={(e) => setReply({ ...reply, title: e.target.value })} /></Field>
          <Field label="Pasted response"><Textarea rows={5} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} /></Field>
          <Button disabled={!reply.title.trim() || !reply.body.trim()} onClick={() => void saveReply()}>Save as note</Button>
        </Card>
      </div>
    </div>
  );
}
