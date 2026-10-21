"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, useApi } from "@/components/client";
import { Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Tabs, Textarea, useToast } from "@/components/ui";
import type { Source, StoredMessage } from "@/lib/chat";

interface Msg { role: "user" | "assistant"; content: string; sources?: Source[] | null; grounded?: boolean; error?: { message: string; hint?: string } }
interface ModelsResp { ok: boolean; selected: string; models: { name: string; sizeBytes: number }[]; error?: string; hint?: string }
interface Conv { id: string; title: string; model: string; updated_at: string }

function Sources({ sources }: { sources: Source[] }) {
  if (!sources.length) return <p className="mt-2 text-xs text-warn">No library passages were retrieved for this question.</p>;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted">Used {sources.length} library passage{sources.length > 1 ? "s" : ""}</summary>
      <ol className="mt-2 space-y-2">
        {sources.map((s) => (
          <li key={s.n} className="rounded-lg border border-line p-2">
            <Link href={`/knowledge/${s.noteId}`} className="font-medium text-accent hover:underline">[{s.n}] {s.title}</Link>
            <span className="ml-2 font-mono text-muted">{s.path}{s.heading ? ` › ${s.heading}` : ""} · passage {s.chunkIndex + 1}</span>
            <p className="mt-1 line-clamp-3 text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Chat() {
  const toast = useToast();
  const models = useApi<ModelsResp>("/api/models");
  const convs = useApi<{ conversations: Conv[] }>("/api/conversations");
  const [model, setModel] = useState("");
  const [convId, setConvId] = useState<string | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [useLibrary, setUseLibrary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (models.data && !model) setModel(models.data.selected);
  }, [models.data, model]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [msgs]);

  async function open(id: string) {
    try {
      const c = await api<{ id: string; model: string; messages: StoredMessage[] }>(`/api/conversations/${id}`);
      setConvId(c.id);
      setModel(c.model);
      setMsgs(c.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content, sources: m.sources, grounded: !!m.sources })));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", grounded: useLibrary }]);
    const ctl = new AbortController();
    abort.current = ctl;
    const patchLast = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    try {
      const res = await fetch("/api/chat", {
        method: "POST", signal: ctl.signal, credentials: "same-origin",
        headers: { "content-type": "application/json", "x-sbos": "1" },
        body: JSON.stringify({ message: text, conversationId: convId, model: model || undefined, useLibrary }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new ApiFailure(res.status, (d as { error?: string }).error ?? "Chat failed", "error");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; text?: string; conversationId?: string; sources?: Source[]; grounded?: boolean; message?: string; hint?: string };
          if (ev.type === "meta") {
            setConvId(ev.conversationId);
            patchLast((m) => ({ ...m, sources: ev.sources, grounded: ev.grounded }));
          } else if (ev.type === "delta") patchLast((m) => ({ ...m, content: m.content + (ev.text ?? "") }));
          else if (ev.type === "error") patchLast((m) => ({ ...m, error: { message: ev.message ?? "Error", hint: ev.hint } }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") patchLast((m) => ({ ...m, error: { message: e instanceof Error ? e.message : "Chat failed" } }));
    } finally {
      setBusy(false);
      abort.current = null;
      void convs.reload();
    }
  }

  const modelList = models.data?.models ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-3">
        <Button className="w-full" onClick={() => { setConvId(undefined); setMsgs([]); }}>New conversation</Button>
        <ul className="space-y-1">
          {convs.data?.conversations.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${c.id === convId ? "bg-surface2" : "hover:bg-surface"}`}>
              <button onClick={() => void open(c.id)} className="min-w-0 flex-1 truncate text-left">{c.title}</button>
              <button aria-label={`Delete conversation ${c.title}`} onClick={() => setDelId(c.id)} className="text-muted hover:text-danger">✕</button>
            </li>
          ))}
          {convs.data?.conversations.length === 0 && <li className="px-2 text-xs text-muted">No conversations yet.</li>}
        </ul>
      </aside>

      <div className="min-w-0 space-y-4">
        {models.data && !models.data.ok && <ErrorBox message={models.data.error ?? "Ollama is unavailable"} hint={models.data.hint} onRetry={() => void models.reload()} />}
        {models.data?.ok && modelList.length === 0 && <ErrorBox message="Ollama is running but has no models installed." hint="ollama pull qwen3.5:9b   (about 6 GB)" />}
        {models.data?.ok && model && !modelList.some((m) => m.name === model) && modelList.length > 0 && <ErrorBox message={`Selected model “${model}” is not installed.`} hint={`ollama pull ${model}`} />}
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-60"><Select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
            {!modelList.some((m) => m.name === model) && model && <option value={model}>{model} (not installed)</option>}
            {modelList.map((m) => <option key={m.name} value={m.name}>{m.name} · {(m.sizeBytes / 1e9).toFixed(1)} GB</option>)}
          </Select></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={useLibrary} onChange={(e) => setUseLibrary(e.target.checked)} />
            Answer from my library
          </label>
        </div>

        <Card className="min-h-80 space-y-4">
          {msgs.length === 0 && <EmptyState title="Ask anything">{useLibrary ? "Answers are grounded in passages retrieved from your notes, with citations. If nothing relevant is found, the assistant says so." : "Library is off: this is a plain chat with the local model. Nothing from your notes is used."}</EmptyState>}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-xl bg-accent/15 px-4 py-2.5 text-sm" : "max-w-full text-sm"}>
              {m.role === "assistant" && m.grounded && <div className="mb-1"><Badge tone="accent">Uses your library</Badge></div>}
              <p className="whitespace-pre-wrap">{m.content || (busy && i === msgs.length - 1 && !m.error ? "…" : "")}</p>
              {m.role === "assistant" && m.grounded && m.sources && <Sources sources={m.sources} />}
              {m.error && <div className="mt-2"><ErrorBox message={m.error.message} hint={m.error.hint} /></div>}
            </div>
          ))}
          <div ref={endRef} />
        </Card>

        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2">
          <Textarea aria-label="Message" rows={2} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} placeholder="Ask a question…  (Enter to send, Shift+Enter for a new line)" className="min-h-0" />
          {busy ? <Button onClick={() => abort.current?.abort()}>Stop</Button> : <Button type="submit" variant="primary" disabled={!input.trim()}>Send</Button>}
        </form>
      </div>

      <ConfirmDialog open={!!delId} title="Delete this conversation?" message="The messages are permanently removed. Your notes are not affected." onCancel={() => setDelId(null)} onConfirm={async () => {
        try {
          await api(`/api/conversations/${delId}`, { method: "DELETE" });
          if (delId === convId) { setConvId(undefined); setMsgs([]); }
          void convs.reload();
        } catch (e) {
          toast(e instanceof Error ? e.message : "Failed", "danger");
        }
        setDelId(null);
      }} />
    </div>
  );
}

function ClaudeHandoff() {
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

export default function AiPage() {
  const [tab, setTab] = useState<"chat" | "claude">("chat");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="AI Workspace" subtitle="Local models via Ollama. Claude is optional and manual." actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: "chat", label: "Local chat" }, { id: "claude", label: "Claude handoff" }]} />} />
      {tab === "chat" ? <Chat /> : <ClaudeHandoff />}
    </div>
  );
}
