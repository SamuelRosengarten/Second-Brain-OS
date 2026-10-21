"use client";
import Link from "next/link";
import { ArrowUp, History, Plus, Sparkles, Square, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/components/blocks";
import { api, ApiFailure, useApi } from "@/components/client";
import { ClaudeHandoff } from "@/components/claude-handoff";
import { Markdown } from "@/components/markdown";
import { SuggestTasksDialog } from "@/components/suggest-tasks";
import { ConfirmDialog, Dialog, ErrorBox, useToast } from "@/components/ui";
import type { Source, StoredMessage } from "@/lib/chat";

interface Msg { role: "user" | "assistant"; content: string; sources?: Source[] | null; grounded?: boolean; workspace?: { projects: number; tasks: number }; semantic?: boolean; ms?: number; error?: { message: string; hint?: string } }
interface ModelsResp { ok: boolean; selected: string; models: { name: string; sizeBytes: number }[]; error?: string; hint?: string }
interface Conv { id: string; title: string; model: string; updated_at: string }
type Scope = { kind: "all" } | { kind: "project"; id: string; name: string } | { kind: "note"; id: string; title: string };

const mono = "font-mono text-[11px] tracking-[0.06em] text-faint";

function groupConversations(list: Conv[]): { label: string; items: Conv[] }[] {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const week = new Date(midnight); week.setDate(week.getDate() - 6);
  const out: { label: string; items: Conv[] }[] = [{ label: "TODAY", items: [] }, { label: "THIS WEEK", items: [] }, { label: "EARLIER", items: [] }];
  for (const c of list) {
    const d = new Date(c.updated_at);
    out[d >= midnight ? 0 : d >= week ? 1 : 2].items.push(c);
  }
  return out.filter((g) => g.items.length);
}

function SourceCard({ s }: { s: Source }) {
  return (
    <Link id={`src-${s.n}`} href={`/knowledge/${s.noteId}`} className="flex scroll-mt-6 flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-3 hover:bg-hover/50 target:border-ai-line">
      <span className="flex items-center gap-2"><span className="rounded-[4px] bg-ai-bg px-[5px] font-mono text-[11px] text-accent">{s.n}</span><span className="min-w-0 truncate text-[13px] font-medium">{s.title}</span></span>
      <span className="line-clamp-3 text-[12.5px] leading-[1.45] text-muted">“{s.text.replace(/\s+/g, " ").slice(0, 160)}”</span>
      <span className="font-mono text-[10.5px] text-faint">NOTE{s.heading ? ` · ${s.heading}` : ""}</span>
    </Link>
  );
}

function Sources({ msg }: { msg: Msg | undefined }) {
  const sources = msg?.sources ?? [];
  const ws = msg?.workspace && (msg.workspace.projects || msg.workspace.tasks) ? msg.workspace : null;
  return (
    <>
      <h2 className="m-0 text-[12.5px] font-semibold text-muted">Sources used · {sources.length}{ws ? " + your projects and tasks" : ""}</h2>
      {sources.length === 0 && <p className="m-0 text-[12.5px] text-faint">{msg ? (ws ? "No note passages matched; the answer drew on your projects and tasks." : "No notes were used for this answer.") : "Ask a question to see which notes it was based on."}</p>}
      {sources.map((s) => <SourceCard key={s.n} s={s} />)}
      {ws && (
        <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface p-3">
          <span className="text-[13px] font-medium">Projects and tasks</span>
          <span className="text-[12.5px] leading-[1.45] text-muted">{ws.projects} {ws.projects === 1 ? "project" : "projects"} and {ws.tasks} {ws.tasks === 1 ? "task" : "tasks"}, read live from your database.</span>
          <span className="font-mono text-[10.5px] text-faint">TASKS · live data</span>
        </div>
      )}
    </>
  );
}

function Chat() {
  const toast = useToast();
  const sp = useSearchParams();
  const { projects } = useProjects();
  const models = useApi<ModelsResp>("/api/models");
  const convs = useApi<{ conversations: Conv[] }>("/api/conversations");
  const [model, setModel] = useState("");
  const [convId, setConvId] = useState<string | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [useLibrary, setUseLibrary] = useState(true);
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [scopeNotes, setScopeNotes] = useState<string[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [taskFrom, setTaskFrom] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // ?q= prefills the box (command palette), ?note= scopes the chat to one note ("Ask about this note")
  useEffect(() => {
    const q = sp.get("q");
    if (q) setInput(q);
    const note = sp.get("note");
    if (note) {
      api<{ note: { id: string; title: string } }>(`/api/notes/${note}`).then((r) => { setScope({ kind: "note", id: r.note.id, title: r.note.title }); setScopeNotes([r.note.id]); }).catch(() => undefined);
    }
  }, [sp]);
  useEffect(() => { if (models.data && !model) setModel(models.data.selected); }, [models.data, model]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  async function pickScope(value: string) {
    if (value === "all") { setScope({ kind: "all" }); setScopeNotes(undefined); return; }
    const p = projects.find((x) => x.id === value);
    if (!p) return;
    try {
      const r = await api<{ notes: { id: string }[] }>(`/api/projects/${p.id}`);
      setScope({ kind: "project", id: p.id, name: p.name });
      setScopeNotes(r.notes.map((n) => n.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  async function open(id: string) {
    try {
      const c = await api<{ id: string; model: string; messages: StoredMessage[] }>(`/api/conversations/${id}`);
      setConvId(c.id);
      setModel(c.model);
      setMsgs(c.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content, sources: m.sources, grounded: !!m.sources })));
      setHistoryOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const t0 = Date.now();
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", grounded: useLibrary }]);
    const ctl = new AbortController();
    abort.current = ctl;
    const patchLast = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    try {
      const res = await fetch("/api/chat", {
        method: "POST", signal: ctl.signal, credentials: "same-origin",
        headers: { "content-type": "application/json", "x-sbos": "1" },
        body: JSON.stringify({ message: text, conversationId: convId, model: model || undefined, useLibrary, noteIds: useLibrary && scopeNotes?.length ? scopeNotes : undefined }),
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
          const ev = JSON.parse(line) as { type: string; text?: string; conversationId?: string; sources?: Source[]; grounded?: boolean; semantic?: boolean; workspace?: { projects: number; tasks: number }; message?: string; hint?: string };
          if (ev.type === "meta") {
            setConvId(ev.conversationId);
            patchLast((m) => ({ ...m, sources: ev.sources, grounded: ev.grounded, workspace: ev.workspace, semantic: ev.semantic }));
          } else if (ev.type === "delta") patchLast((m) => ({ ...m, content: m.content + (ev.text ?? "") }));
          else if (ev.type === "error") patchLast((m) => ({ ...m, error: { message: ev.message ?? "Error", hint: ev.hint } }));
          else if (ev.type === "done") patchLast((m) => ({ ...m, ms: Date.now() - t0 }));
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

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied", "ok");
    } catch {
      toast("Clipboard unavailable (needs HTTPS or localhost).", "danger");
    }
  }
  async function saveAsNote(i: number) {
    const m = msgs[i];
    const question = [...msgs.slice(0, i)].reverse().find((x) => x.role === "user")?.content ?? "Answer";
    const title = question.replace(/\s+/g, " ").slice(0, 70);
    const cites = (m.sources ?? []).map((s) => `- [[${s.title}]]`).join("\n");
    try {
      const r = await api<{ note: { id: string } }>("/api/notes", { body: { title, body: `${m.content}${cites ? `\n\n## Sources\n\n${cites}` : ""}\n`, tags: ["ask"], summary: question.slice(0, 160) } });
      toast("Saved as a note", "ok", { label: "Open", onClick: () => { window.location.href = `/knowledge/${r.note.id}`; } });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  const modelList = models.data?.models ?? [];
  const groups = useMemo(() => groupConversations(convs.data?.conversations ?? []), [convs.data]);
  const lastWithSources = [...msgs].reverse().find((m) => m.role === "assistant" && (m.sources?.length || m.workspace));
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const live = projects.filter((p) => p.status !== "archived");

  const conversationList = (
    <>
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <div className={`${mono} px-2 pt-1.5 pb-1`}>{g.label}</div>
          {g.items.map((c) => (
            <div key={c.id} className="group flex items-center rounded-[9px] hover:bg-hover/50" style={{ background: c.id === convId ? "var(--hover)" : undefined }}>
              <button type="button" onClick={() => void open(c.id)} aria-current={c.id === convId ? "true" : undefined} className={`min-w-0 flex-1 truncate px-2.5 py-2.5 text-left text-[13px] leading-[1.35] ${c.id === convId ? "text-fg" : "text-muted"}`}>{c.title}</button>
              <button type="button" aria-label={`Delete conversation ${c.title}`} onClick={() => setDelId(c.id)} className="mr-1 grid size-8 shrink-0 place-items-center rounded-md text-faint hover:text-danger lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"><X size={14} aria-hidden /></button>
            </div>
          ))}
        </div>
      ))}
      {groups.length === 0 && <p className="m-0 px-2 text-[12.5px] text-faint">No conversations yet.</p>}
    </>
  );

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-wrap items-stretch lg:-mx-10 lg:-mt-8 lg:-mb-12 lg:min-h-dvh">
      {/* ---------- conversations (desktop) ---------- */}
      <nav aria-label="Conversations" className="hidden min-w-0 max-w-[260px] flex-[1_1_230px] flex-col gap-3.5 border-r border-line px-3 pt-7 pb-5 lg:flex">
        <div className="flex items-center gap-2 px-1.5">
          <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Ask</h1>
          <button type="button" aria-label="New conversation" onClick={() => { setConvId(undefined); setMsgs([]); }} className="ml-auto grid size-[34px] place-items-center rounded-[9px] bg-primary text-primary-fg hover:bg-primary-hover"><Plus size={15} aria-hidden strokeWidth={2} /></button>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto">{conversationList}</div>
      </nav>

      {/* ---------- conversation ---------- */}
      <section aria-label="Conversation" className="flex min-w-0 flex-[999_1_460px] flex-col gap-3.5 lg:gap-[22px] lg:px-10 lg:py-6">
        <header className="flex items-center gap-2.5 lg:hidden">
          <h1 className="m-0 text-[30px] leading-[1.15] font-semibold tracking-[-0.025em]">Ask</h1>
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 font-mono text-[11.5px] text-muted"><span aria-hidden className={`size-[7px] rounded-full ${models.data?.ok ? "bg-ok" : "bg-danger"}`} />{model || "model"}</span>
          <button type="button" aria-label="Past conversations" onClick={() => setHistoryOpen(true)} className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-muted"><History size={18} aria-hidden strokeWidth={1.8} /></button>
        </header>

        {models.data && !models.data.ok && <ErrorBox message={models.data.error ?? "Ollama is unavailable"} hint={models.data.hint} onRetry={() => void models.reload()} />}
        {models.data?.ok && model && !modelList.some((m) => m.name === model) && modelList.length > 0 && <ErrorBox message={`Selected model “${model}” is not installed.`} hint={`ollama pull ${model}`} />}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={useLibrary} onClick={() => setUseLibrary((v) => !v)} className="flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium lg:h-8 lg:text-[12.5px]" style={{ borderColor: useLibrary ? "var(--ai-line)" : "var(--border)", background: useLibrary ? "var(--ai-bg)" : "transparent", color: useLibrary ? "var(--accent)" : "var(--muted)" }}>
            <span aria-hidden className="size-[7px] rounded-full" style={{ background: useLibrary ? "var(--accent)" : "var(--faint)" }} />Uses your library
          </button>
          <label className="relative flex h-9 items-center rounded-full border border-line px-3 text-[13px] text-muted lg:h-8 lg:text-[12.5px]">
            <span aria-hidden>Scope: {scope.kind === "all" ? "All notes" : scope.kind === "project" ? scope.name : scope.title.length > 22 ? `${scope.title.slice(0, 21)}…` : scope.title} ▾</span>
            <span className="sr-only">Scope</span>
            <select value={scope.kind === "project" ? scope.id : scope.kind === "note" ? "note" : "all"} onChange={(e) => void pickScope(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
              <option value="all">All notes</option>
              {scope.kind === "note" && <option value="note">This note: {scope.title}</option>}
              {live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="relative ml-auto hidden h-8 items-center rounded-full border border-line px-3 font-mono text-[11.5px] text-muted lg:flex">
            <span aria-hidden>{model || "model"} ▾</span>
            <span className="sr-only">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
              {!modelList.some((m) => m.name === model) && model && <option value={model}>{model} (not installed)</option>}
              {modelList.map((m) => <option key={m.name} value={m.name}>{m.name} · {(m.sizeBytes / 1e9).toFixed(1)} GB</option>)}
            </select>
          </label>
        </div>

        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-[22px]">
          {msgs.length === 0 && (
            <div className="m-auto flex max-w-md flex-col items-center gap-2 py-12 text-center">
              <span className="grid size-11 place-items-center rounded-2xl bg-ai-bg text-accent"><Sparkles size={20} aria-hidden /></span>
              <p className="m-0 text-base font-medium">Ask about your notes, tasks and projects</p>
              <p className="m-0 text-[13px] text-muted">{useLibrary ? "Answers cite your notes and use your live projects and tasks. If nothing matches, it says so." : "Library is off: this is a plain chat with the local model."}</p>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="max-w-[84%] self-end rounded-[16px_16px_4px_16px] bg-surface2 px-3.5 py-3 text-[15px] leading-normal whitespace-pre-wrap lg:max-w-[80%] lg:rounded-[14px_14px_4px_14px] lg:px-4">{m.content}</div>
            ) : (
              <div key={i} className="flex gap-3.5">
                <span aria-hidden className="hidden size-[30px] shrink-0 place-items-center rounded-[9px] bg-ai-bg text-accent lg:grid"><Sparkles size={15} strokeWidth={1.8} /></span>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  {m.grounded && <span className="flex items-center gap-1.5 text-xs text-accent lg:hidden"><Sparkles size={13} aria-hidden strokeWidth={1.8} />Local answer · {m.sources?.length ?? 0} {(m.sources?.length ?? 0) === 1 ? "source" : "sources"}</span>}
                  <div className="text-[15.5px] leading-[1.6] text-[#dfe3ea] lg:text-[15px] lg:leading-[1.7]" style={{ color: "var(--text)" }}>
                    {m.content ? <Markdown source={m.content} cite={(n) => !!m.sources?.some((s) => s.n === n)} /> : busy && i === msgs.length - 1 && !m.error ? <p className="m-0 text-muted">Thinking…</p> : null}
                  </div>
                  {m.error && <ErrorBox message={m.error.message} hint={m.error.hint} />}
                  {i === msgs.length - 1 && (m.sources?.length || m.workspace) ? (
                    <div role="list" aria-label="Sources" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
                      {m.sources?.map((s) => <div key={s.n} role="listitem" className="w-[220px] shrink-0"><SourceCard s={s} /></div>)}
                    </div>
                  ) : null}
                  {m.content && !(busy && i === msgs.length - 1) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => void copy(m.content)} className="h-10 rounded-[10px] border border-line px-3 text-[13px] text-muted hover:bg-hover lg:h-[30px] lg:rounded-lg lg:text-[12.5px]">Copy</button>
                      <button type="button" onClick={() => void saveAsNote(i)} className="h-10 rounded-[10px] border border-line px-3 text-[13px] text-muted hover:bg-hover lg:h-[30px] lg:rounded-lg lg:text-[12.5px]">Save as note</button>
                      <button type="button" onClick={() => setTaskFrom(m.content)} className="h-10 rounded-[10px] border border-line px-3 text-[13px] text-muted hover:bg-hover lg:h-[30px] lg:rounded-lg lg:text-[12.5px]">Make a task</button>
                      {m.ms ? <span className="ml-auto hidden self-center font-mono text-[11px] text-faint lg:block">{m.sources?.length ?? 0} {(m.sources?.length ?? 0) === 1 ? "source" : "sources"} · {(m.ms / 1000).toFixed(1)} s</span> : null}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] mx-auto flex w-full max-w-[760px] flex-col gap-2 rounded-2xl border border-line2 bg-surface p-1.5 pl-4 lg:static lg:rounded-[14px] lg:border-line lg:p-3">
          <label htmlFor="ask-in" className="sr-only">Message</label>
          <div className="flex items-center gap-2 lg:items-end">
            <textarea id="ask-in" rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} placeholder="Ask about your notes and tasks" className="max-h-40 min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent py-2.5 text-base leading-normal text-fg outline-none placeholder:text-faint lg:min-h-14 lg:py-1 lg:text-[15px]" />
            {busy ? (
              <button type="button" aria-label="Stop" onClick={() => abort.current?.abort()} className="grid size-11 shrink-0 place-items-center rounded-xl border border-line text-fg lg:size-9 lg:rounded-[9px]"><Square size={14} aria-hidden /></button>
            ) : (
              <button type="submit" aria-label="Send" disabled={!input.trim()} className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-fg disabled:opacity-45 lg:size-9 lg:rounded-[9px]"><ArrowUp size={18} aria-hidden strokeWidth={2.2} /></button>
            )}
          </div>
          <p className="m-0 hidden px-1 text-xs text-faint lg:block">Answers cite your notes. If nothing matches, it says so. Enter sends, Shift+Enter adds a line.</p>
        </form>
      </section>

      {/* ---------- sources (desktop) ---------- */}
      <aside aria-label="Sources" className="hidden min-w-0 max-w-[310px] flex-[1_1_260px] flex-col gap-3 border-l border-line px-[18px] py-6 lg:flex">
        <Sources msg={lastWithSources} />
        <section aria-labelledby="ho-h" className="mt-auto flex flex-col gap-2 rounded-xl border border-line bg-surface2 p-3.5">
          <h3 id="ho-h" className="m-0 text-[13px] font-semibold">Need a deeper answer?</h3>
          <p className="m-0 text-[12.5px] leading-[1.45] text-muted">Package this question with its sources for Claude. You copy and paste it yourself; nothing is sent automatically.</p>
          <button type="button" onClick={() => setClaudeOpen(true)} className="h-[34px] rounded-[9px] border border-line bg-surface text-[12.5px] font-medium hover:bg-hover">Build a Claude package</button>
        </section>
      </aside>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title="Past conversations" footer={<button type="button" onClick={() => { setConvId(undefined); setMsgs([]); setHistoryOpen(false); }} className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-fg">New conversation</button>}>
        <div className="flex flex-col gap-2 text-fg">{conversationList}</div>
      </Dialog>
      <Dialog open={claudeOpen} onClose={() => setClaudeOpen(false)} title="Build a Claude package" wide><ClaudeHandoff /></Dialog>
      <SuggestTasksDialog open={taskFrom !== null} onClose={() => setTaskFrom(null)} conversationId={convId} model={model || undefined} initialRequest={taskFrom ? `${lastUser}\n\n${taskFrom}`.slice(0, 1900) : ""} projects={live.map((p) => ({ id: p.id, name: p.name }))} />
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

export default function AiPage() {
  return (
    <Suspense fallback={null}>
      <Chat />
    </Suspense>
  );
}
