"use client";
import { Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { useProjects } from "./blocks";
import { api } from "./client";
import { cx, useToast } from "./ui";
import type { CreateCaptureResult } from "@/lib/captures";

const TYPES = [
  { id: "idea", label: "Note" },
  { id: "task", label: "Task" },
  { id: "link", label: "Link" },
] as const;
type Type = (typeof TYPES)[number]["id"];

/**
 * The capture card on Today. Saved first (the original is never lost), then your local AI proposes a title and tags
 * that you review in the Inbox. Ctrl+Enter saves.
 */
export function TodayCapture({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const { projects } = useProjects();
  const [type, setType] = useState<Type>("idea");
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    const content = text.trim();
    if ((!content && !files.length) || busy) return;
    setBusy(true);
    try {
      const isUrl = /^https?:\/\/\S+$/i.test(content);
      const form = new FormData();
      form.set("kind", files.length ? "file" : isUrl || type === "link" ? "link" : type);
      form.set("content", content);
      if (isUrl || type === "link") form.set("url", isUrl ? content : "");
      form.set("process", "1");
      if (projectId) form.set("project_id", projectId);
      files.forEach((f) => form.append("files", f));
      const r = await api<CreateCaptureResult>("/api/captures", { form });
      if (!r.duplicate) {
        setText("");
        setFiles([]);
        if (fileRef.current) fileRef.current.value = "";
      }
      toast(r.duplicate ? "Already captured" : "Saved to your inbox. Your local model is drafting a title and tags", "ok");
      onSaved?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Quick capture" className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-3.5 pt-3.5 pb-3 focus-within:border-line2">
      <label htmlFor="today-capture" className="px-1.5 text-xs text-faint">Capture</label>
      <textarea
        id="today-capture"
        rows={2}
        value={text}
        placeholder="A thought, a task, a link. It is saved the moment you press Save."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}
        className="resize-none border-0 bg-transparent px-1.5 text-base leading-normal text-fg outline-none placeholder:text-faint"
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex h-7 items-center gap-1.5 rounded-md bg-surface2 pr-1 pl-2.5 text-xs text-muted">
              <span className="max-w-48 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} className="grid size-6 place-items-center rounded text-faint hover:text-fg"><X size={13} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Capture type" className="flex rounded-[9px] border border-line bg-bg p-[3px]">
          {TYPES.map((t) => (
            <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)} className={cx("h-[30px] rounded-[7px] px-3 text-[12.5px] font-medium", type === t.id ? "bg-surface2 text-fg" : "text-muted hover:text-fg")}>{t.label}</button>
          ))}
        </div>
        <label className="relative flex h-[38px] items-center gap-2 rounded-[9px] border border-line px-3 text-[12.5px] text-muted focus-within:border-accent">
          <span className="sr-only">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-full max-w-44 cursor-pointer appearance-none bg-transparent pr-5 text-[12.5px] text-muted outline-none">
            <option value="">No project</option>
            {projects.filter((p) => p.status !== "archived").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <svg aria-hidden className="pointer-events-none absolute right-2.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
        </label>
        <input ref={fileRef} id="today-capture-files" type="file" multiple accept=".md,.markdown,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp" className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <label htmlFor="today-capture-files" className="grid size-[38px] cursor-pointer place-items-center rounded-[9px] border border-line text-muted hover:bg-hover focus-within:outline-2">
          <Paperclip size={16} aria-hidden strokeWidth={1.8} />
          <span className="sr-only">Attach a file</span>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-faint xl:inline">Your local model suggests a title and tags afterwards</span>
          <button type="button" onClick={() => void save()} disabled={busy || (!text.trim() && !files.length)} className="flex h-[38px] items-center gap-2 rounded-[9px] bg-primary px-3.5 text-[13px] font-semibold text-primary-fg hover:bg-primary-hover disabled:opacity-45">
            Save<span aria-hidden className="font-mono text-[11px] opacity-70">Ctrl ↵</span>
          </button>
        </div>
      </div>
    </section>
  );
}
