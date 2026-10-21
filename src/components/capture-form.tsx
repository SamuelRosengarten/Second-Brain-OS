"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { api, saveFailureMessage, useDraft } from "./client";
import { Button, Field, Select, Textarea, Input, useToast, ErrorBox } from "./ui";
import type { CreateCaptureResult } from "@/lib/captures";

const KINDS = [
  { v: "idea", l: "Idea" },
  { v: "text", l: "Plain text" },
  { v: "task", l: "Task" },
  { v: "project_note", l: "Project note" },
  { v: "link", l: "Web link" },
  { v: "excerpt", l: "Pasted excerpt" },
];

const EMPTY = { kind: "idea", content: "", url: "" };

export function CaptureForm({ onSaved, compact }: { onSaved?: (r: CreateCaptureResult) => void; compact?: boolean }) {
  const toast = useToast();
  const draft = useDraft("sbos-draft-capture", EMPTY, ["content", "url"]);
  const { kind, content, url } = draft.value;
  const setKind = (v: string) => draft.setValue((d) => ({ ...d, kind: v }));
  const setContent = (v: string) => draft.setValue((d) => ({ ...d, content: v }));
  const setUrl = (v: string) => draft.setValue((d) => ({ ...d, url: v }));
  const [files, setFiles] = useState<File[]>([]);
  const [process, setProcess] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CreateCaptureResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return; // duplicate-submission guard
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("kind", files.length ? "file" : kind);
      form.set("content", content);
      form.set("url", url);
      form.set("process", process ? "1" : "0");
      files.forEach((f) => form.append("files", f));
      const r = await api<CreateCaptureResult>("/api/captures", { form });
      setSaved(r);
      toast(r.duplicate ? "Already captured — showing the existing item" : process ? "Saved. AI processing started" : "Saved to inbox");
      if (!r.duplicate) {
        draft.clear();
        setKind(kind); // keep the chosen type, as before
        setFiles([]);
        if (fileRef.current) fileRef.current.value = "";
      }
      onSaved?.(r);
    } catch (err) {
      setError(saveFailureMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const showUrl = kind === "link" || url;
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <div className="w-40 shrink-0">
          <Select aria-label="Capture type" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.v} value={k.v}>
                {k.l}
              </option>
            ))}
          </Select>
        </div>
        <Input aria-label="Web link (optional)" placeholder="https:// link (optional)" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} className={showUrl || !compact ? "" : "hidden sm:block"} />
      </div>
      <Textarea aria-label="Capture content" placeholder="What's on your mind? Paste text, an idea, a task…" rows={compact ? 3 : 7} value={content} onChange={(e) => setContent(e.target.value)} />
      <Field label="Attach files" hint="Markdown, text, PDF or images. Max 25 MB each. Files are stored as-is and never executed.">
        <input ref={fileRef} type="file" multiple accept=".md,.markdown,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface2 file:px-3 file:py-2 file:text-fg" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={process} onChange={(e) => setProcess(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        Process with local AI after saving
      </label>
      {draft.restored && (
        <p className="text-sm text-muted">
          Restored your unsent draft (attached files are not kept).{" "}
          <button type="button" onClick={() => { draft.clear(); setFiles([]); }} className="text-accent hover:underline">Discard</button>
        </p>
      )}
      {error && <ErrorBox message={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!content.trim() && !url.trim() && !files.length}>
          Save capture
        </Button>
        {saved && (
          <Link href={`/inbox/${saved.capture.id}`} className="text-sm text-accent hover:underline">
            Open in inbox →
          </Link>
        )}
      </div>
    </form>
  );
}
