"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Paperclip } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { ProjectSquare, useProjects } from "@/components/blocks";
import { api, localToday } from "@/components/client";
import { cx, ErrorBox, useToast } from "@/components/ui";
import { dowDay } from "@/lib/dates";
import type { CreateCaptureResult } from "@/lib/captures";

const TYPES = [{ id: "idea", label: "Note" }, { id: "task", label: "Task" }, { id: "link", label: "Link" }] as const;
type Type = (typeof TYPES)[number]["id"];

/** Shared text arrives as ?title=&text=&url= (web share target). A lone link in `text` is treated as the link. */
function prefill(p: URLSearchParams): { content: string; url: string } {
  const title = (p.get("title") ?? "").trim();
  let text = (p.get("text") ?? "").trim();
  let url = (p.get("url") ?? "").trim();
  if (!url && /^https?:\/\/\S+$/i.test(text)) {
    url = text;
    text = "";
  }
  return { content: [title, text].filter((s, i, all) => s && all.indexOf(s) === i).join("\n\n"), url };
}

function Row({ label, value, children }: { label: string; value: React.ReactNode; children: React.ReactNode }) {
  // The native control sits invisibly over the whole row, so a tap anywhere opens the picker.
  return (
    <li className="relative border-t border-line first:border-t-0">
      <div className="flex min-h-[52px] items-center gap-3 px-4 text-[15px]">
        <span className="flex-1">{label}</span>
        <span className="flex items-center gap-1.5 text-muted">{value}</span>
        <ChevronRight size={16} aria-hidden strokeWidth={2} className="text-faint" />
      </div>
      {children}
    </li>
  );
}

function CaptureScreen() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { projects, colorOf } = useProjects();
  const today = localToday();
  const shared = prefill(sp);
  const [type, setType] = useState<Type>(shared.url && !shared.content ? "link" : "idea");
  const [text, setText] = useState(shared.content || shared.url);
  const [projectId, setProjectId] = useState("");
  const [due, setDue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tidy, setTidy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!window.matchMedia("(pointer: coarse)").matches) area.current?.focus(); }, []);

  const project = projects.find((p) => p.id === projectId);
  const canSave = (text.trim() || shared.url || files.length) && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const content = text.trim();
      const isUrlText = /^https?:\/\/\S+$/i.test(content);
      // A link shared into the app keeps its link even when you add words of your own.
      const link = type === "link" || isUrlText || !!shared.url;
      const form = new FormData();
      form.set("kind", files.length ? "file" : link ? "link" : type);
      form.set("content", content);
      form.set("url", isUrlText ? content : shared.url);
      form.set("process", tidy ? "1" : "0");
      if (projectId) form.set("project_id", projectId);
      if (type === "task" && due) form.set("due", due);
      files.forEach((f) => form.append("files", f));
      const r = await api<CreateCaptureResult>("/api/captures", { form });
      toast(r.duplicate ? "Already captured" : tidy ? "Saved to your inbox. Your local model is drafting a title and tags" : "Saved to your inbox", "ok");
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-xl flex-col gap-[18px] lg:min-h-0">
      <header className="flex items-center gap-2">
        <Link href="/" className="flex min-h-11 min-w-16 items-center text-base text-muted hover:text-fg">Cancel</Link>
        <h1 className="m-0 flex-1 text-center text-base font-semibold">New capture</h1>
        <span className="min-w-16" aria-hidden />
      </header>

      <div role="group" aria-label="Capture type" className="flex rounded-xl border border-line bg-surface p-1">
        {TYPES.map((t) => (
          <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)} className={cx("h-10 flex-1 rounded-[9px] text-sm", type === t.id ? "bg-hover font-semibold text-fg" : "font-medium text-muted")}>{t.label}</button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="capture-text" className="px-1 text-[13px] text-muted">{type === "link" ? "Paste a link" : type === "task" ? "What needs doing?" : "What is on your mind?"}</label>
        <textarea
          id="capture-text"
          ref={area}
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}
          className="w-full resize-none rounded-[14px] border border-line2 bg-surface px-4 py-3.5 text-lg leading-normal text-fg outline-none focus:border-accent"
        />
      </div>

      {shared.url && <p className="m-0 -mt-2 px-1 text-[13px] break-all text-muted">Shared link: <span className="font-mono text-xs text-fg">{shared.url}</span></p>}

      <ul className="m-0 list-none overflow-hidden rounded-[14px] border border-line bg-surface p-0">
        <Row label="Project" value={<><ProjectSquare color={projectId ? colorOf(projectId) : "var(--faint)"} />{project?.name ?? "None"}</>}>
          <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
            <option value="">No project</option>
            {projects.filter((p) => p.status !== "archived").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Row>
        {type === "task" && (
          <Row label="Due" value={<span className={cx("font-mono text-[13px]", due && "text-warn")}>{due ? dowDay(due) : "No date"}</span>}>
            <input aria-label="Due date" type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </Row>
        )}
        <li className="relative border-t border-line first:border-t-0">
          <div className="flex min-h-[52px] items-center gap-3 px-4 text-[15px]">
            <span className="flex-1">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} attached` : "Attach a photo or file"}</span>
            <Paperclip size={18} aria-hidden strokeWidth={1.8} className="text-faint" />
          </div>
          <input aria-label="Attach a photo or file" type="file" multiple accept=".md,.markdown,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </li>
      </ul>

      <label className="flex min-h-[60px] cursor-pointer items-center gap-3 rounded-[14px] border border-dashed border-ai-line bg-ai-soft px-4">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px]">Let my local AI tidy it up</span>
          <span className="text-[12.5px] text-muted">You review its title and tags before anything is saved</span>
        </span>
        <input type="checkbox" role="switch" checked={tidy} onChange={(e) => setTidy(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className="relative block h-[30px] w-[50px] shrink-0 rounded-[15px] bg-line2 transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-checked:[&>span]:translate-x-5">
          <span className="absolute top-[3px] left-[3px] size-6 rounded-full bg-bg transition-transform" />
        </span>
      </label>

      {error && <ErrorBox message={error} />}

      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <p className="m-0 text-center text-[13px] text-faint text-pretty">Saved right away, before any AI runs. Your PC processes it the next time it is online.</p>
        <button type="button" onClick={() => void save()} disabled={!canSave} className="h-[54px] rounded-[14px] bg-primary text-base font-semibold text-primary-fg hover:bg-primary-hover disabled:opacity-45">{busy ? "Saving…" : "Save to inbox"}</button>
      </div>
    </div>
  );
}

export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <CaptureScreen />
    </Suspense>
  );
}
