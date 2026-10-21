"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, localToday } from "./client";
import { Button, Dialog, ErrorBox, Field, Input, Select, Textarea, useToast } from "./ui";
import type { SuggestResult, TaskSuggestion } from "@/lib/task-suggestions";

type Row = TaskSuggestion & { on: boolean };

/**
 * "Suggest tasks": the local model proposes tasks, you tick, edit and add the ones you want.
 * Nothing is created until you press Add, and each task is then an ordinary task (editable, deletable, in the trash if removed).
 */
export function SuggestTasksDialog({ open, onClose, conversationId, model, initialRequest, projects, onAdded }: {
  open: boolean; onClose: () => void; conversationId?: string; model?: string; initialRequest: string; projects: { id: string; name: string }[]; onAdded?: () => void;
}) {
  const toast = useToast();
  const [request, setRequest] = useState(initialRequest);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const today = localToday();

  useEffect(() => {
    if (open) {
      setRequest(initialRequest);
      setRows(null);
      setError(null);
      setNote("");
    } else ctl.current?.abort();
  }, [open, initialRequest]);

  async function suggest() {
    if (!request.trim() || busy) return;
    setBusy(true);
    setError(null);
    setRows(null);
    ctl.current = new AbortController();
    try {
      const r = await api<SuggestResult>("/api/tasks/suggest", { body: { request, conversationId, projectId: projectId || undefined, model: model || undefined, today } });
      setRows(r.suggestions.map((s) => ({ ...s, on: true })));
      setNote(
        r.suggestions.length === 0
          ? "The model did not find new tasks to suggest. Try describing what you want to get done."
          : r.skippedDuplicates
            ? `${r.skippedDuplicates} suggestion${r.skippedDuplicates > 1 ? "s" : ""} skipped because you already have that task.`
            : "",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get suggestions");
    } finally {
      setBusy(false);
    }
  }

  const patch = (i: number, p: Partial<Row>) => setRows((all) => all?.map((r, j) => (j === i ? { ...r, ...p } : r)) ?? null);
  const chosen = rows?.filter((r) => r.on && r.title.trim()) ?? [];

  async function add() {
    if (!chosen.length || adding) return;
    setAdding(true);
    let ok = 0;
    try {
      for (const r of chosen) {
        await api("/api/tasks", { body: { title: r.title, description: r.description, priority: r.priority, due_date: r.due_date, project_id: r.project_id } });
        ok++;
      }
      toast(`Added ${ok} task${ok > 1 ? "s" : ""}`, "ok");
      onAdded?.();
      onClose();
    } catch (e) {
      toast(`${ok} added, then it failed: ${e instanceof Error ? e.message : "error"}`, "danger");
      onAdded?.();
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Suggest tasks"
      noKeyboardOnTouch
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {rows && rows.length > 0 && (
            <Button variant="primary" loading={adding} disabled={!chosen.length} onClick={() => void add()}>
              Add {chosen.length} task{chosen.length === 1 ? "" : "s"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p>Describe what you want to get done. The local model proposes tasks; nothing is saved until you add them.</p>
        <Field label="What should I plan?"><Textarea rows={3} value={request} maxLength={2000} onChange={(e) => setRequest(e.target.value)} /></Field>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Let the model pick (or none)</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Button variant="primary" loading={busy} disabled={!request.trim()} onClick={() => void suggest()}>
          <Sparkles size={14} aria-hidden />
          {rows ? "Suggest again" : "Suggest tasks"}
        </Button>
        {busy && <p role="status" className="text-xs text-muted">Thinking... a local model can take a minute.</p>}
        {error && <ErrorBox message={error} />}
        {note && <p role="status" className="text-xs text-muted">{note}</p>}
        {rows && rows.length > 0 && (
          <ul className="space-y-2" aria-label="Suggested tasks">
            {rows.map((r, i) => (
              <li key={i} className="space-y-2 rounded-lg border border-line bg-surface p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={r.on} onChange={(e) => patch(i, { on: e.target.checked })} className="mt-2 size-5 shrink-0 accent-[var(--accent)]" aria-label={`Add suggestion ${i + 1}`} />
                  <Input aria-label={`Title of suggestion ${i + 1}`} value={r.title} maxLength={300} onChange={(e) => patch(i, { title: e.target.value })} />
                </div>
                {r.description && <p className="pl-7 text-xs text-muted">{r.description}</p>}
                <div className="flex flex-wrap gap-2 pl-7">
                  <Select aria-label={`Priority of suggestion ${i + 1}`} value={r.priority} onChange={(e) => patch(i, { priority: e.target.value as Row["priority"] })} className="w-28">
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </Select>
                  <Input aria-label={`Due date of suggestion ${i + 1}`} type="date" min={today} value={r.due_date ?? ""} onChange={(e) => patch(i, { due_date: e.target.value || null })} className="w-40 tnum" />
                  <Select
                    aria-label={`Project of suggestion ${i + 1}`}
                    value={r.project_id ?? ""}
                    onChange={(e) => patch(i, { project_id: e.target.value || null, project_name: projects.find((p) => p.id === e.target.value)?.name ?? null })}
                    className="w-44"
                  >
                    <option value="">No project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
