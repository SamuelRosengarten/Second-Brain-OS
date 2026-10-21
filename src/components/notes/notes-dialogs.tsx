"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../client";
import { Badge, Button, Dialog, ErrorBox, Field, Input, Textarea, useToast } from "../ui";

interface ImportResult { filename: string; status: string; error?: string }

export function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, [open]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const r = await api<{ results: ImportResult[] }>("/api/import", { form });
      setResults(r.results);
      setFiles([]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }
  const pick = (list: FileList | null) => setFiles(Array.from(list ?? []).filter((f) => /\.(md|markdown|txt|pdf)$/i.test(f.name)));
  const fileInput = "mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-fg";
  return (
    <Dialog open={open} onClose={() => { setResults(null); setError(null); onClose(); }} title="Import files" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={busy} disabled={!files.length} onClick={() => void run()}>Import {files.length || ""} file{files.length === 1 ? "" : "s"}</Button></>}>
      <div className="space-y-3">
        <p>Choose files or a whole folder. Only the items you select are read. Originals are copied to your <code>imports</code> folder; a Markdown note is created for each. Supported: Markdown, text, PDF with a text layer. Duplicates are skipped.</p>
        <label className="block text-sm text-fg">Files<input type="file" multiple accept=".md,.markdown,.txt,.pdf" onChange={(e) => pick(e.target.files)} className={fileInput} /></label>
        <label className="block text-sm text-fg">Or a folder<input ref={folderRef} type="file" multiple onChange={(e) => pick(e.target.files)} className={fileInput} /></label>
        {files.length > 0 && <p className="text-fg"><span className="tnum">{files.length}</span> supported file(s) selected.</p>}
        {error && <ErrorBox message={error} />}
        {results && (
          <ul className="max-h-48 space-y-1 overflow-auto text-xs">
            {results.map((r, i) => (
              <li key={i} className="flex gap-2"><Badge tone={r.status === "imported" ? "ok" : r.status === "duplicate" ? "neutral" : "danger"}>{r.status}</Badge><span className="truncate text-fg">{r.filename}</span>{r.error && <span className="text-muted">{r.error}</span>}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export function NewNoteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ note: { id: string } }>("/api/notes", { body: { title, body, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      toast("Note created");
      setTitle(""); setBody(""); setTags("");
      onDone();
      onClose();
      router.push(`/knowledge/${r.note.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="New note" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void save()}>Create</Button></>}>
      <div className="space-y-3 text-fg">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Body (Markdown)"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
