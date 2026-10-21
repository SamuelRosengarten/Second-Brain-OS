"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../client";
import { useToast } from "../ui";
import type { Capture } from "@/lib/captures";

export interface DraftTask { key: string; title: string; due: string; checked: boolean }
export interface Draft {
  title: string; summary: string; category: string; tags: string[]; body: string;
  projectId: string; tasks: DraftTask[];
  related: { id: string; title: string } | null; linkRelated: boolean;
}

/** The first line of a capture, trimmed to a title-sized string. */
export const titleOf = (c: Capture): string => c.proposal?.title ?? (c.content.replace(/\s+/g, " ").trim().slice(0, 80) || "(empty)");

/** Turns a capture (and its AI proposal, if any) into the editable draft shown in the review. Pure, so it is easy to test. */
export function seedDraft(c: Capture, projects: { id: string; name: string }[]): Draft {
  const p = c.proposal;
  const matched = projects.find((pr) => p?.related_projects.includes(pr.name))?.id ?? "";
  const hint = c.hint_project_id && projects.some((pr) => pr.id === c.hint_project_id) ? c.hint_project_id : "";
  const tasks: DraftTask[] = [];
  const add = (title: string, due: string | undefined) => { if (title.trim()) tasks.push({ key: `t${tasks.length}`, title: title.trim(), due: due ?? "", checked: true }); };
  if (p) {
    if (p.next_action.trim()) add(p.next_action, c.hint_due ?? undefined);
    for (const t of p.tasks ?? []) add(t.title, t.due_date || undefined);
  }
  // A capture typed as a task becomes a task even if the model proposed none.
  if (c.kind === "task" && tasks.length === 0) add(p?.title ?? c.content.split("\n")[0].slice(0, 120), c.hint_due ?? undefined);
  return {
    title: titleOf(c),
    summary: p?.summary ?? "",
    category: p?.category ?? "",
    tags: p?.tags ?? [],
    body: p?.note_markdown ?? c.content,
    projectId: hint || matched,
    tasks,
    related: null,
    linkRelated: false,
  };
}

/** Everything the review screens share: the draft, polling while the model works, and the accept / dismiss / process actions. */
export function useCaptureDraft(id: string | null, projects: { id: string; name: string }[], onChanged?: () => void) {
  const toast = useToast();
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!id) { setCapture(null); return; }
    const my = ++seq.current;
    try {
      const r = await api<{ capture: Capture }>(`/api/captures/${id}`);
      if (my !== seq.current) return;
      setCapture(r.capture);
      setError(null);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "Capture not found");
    }
  }, [id]);
  useEffect(() => { setDraft(null); setCapture(null); void load(); }, [load]);

  // Re-seed the draft when the capture (or its proposal) changes, never while you are typing in it.
  const seededFor = useRef("");
  useEffect(() => {
    if (!capture) return;
    const stamp = `${capture.id}:${capture.status}:${capture.updated_at}:${projects.length}`;
    if (seededFor.current === stamp) return;
    seededFor.current = stamp;
    setContent(capture.content);
    setDraft(seedDraft(capture, projects));
  }, [capture, projects]);

  // The model can take a minute: poll while it works.
  useEffect(() => {
    if (capture?.status !== "processing") return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [capture?.status, load]);

  // A similar existing note (by meaning) is offered as an optional link; failure just means no offer.
  const relatedFor = useRef("");
  useEffect(() => {
    if (!capture || !draft || !["proposed", "new"].includes(capture.status) || relatedFor.current === capture.id) return;
    relatedFor.current = capture.id;
    const q = `${draft.title} ${draft.summary}`.trim().slice(0, 200);
    if (!q) return;
    api<{ hits: { noteId: string; title: string }[]; semantic: { used: boolean } }>(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => { const h = r.hits[0]; if (h) setDraft((d) => (d ? { ...d, related: { id: h.noteId, title: h.title } } : d)); })
      .catch(() => undefined);
  }, [capture, draft]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      toast(e instanceof ApiFailure || e instanceof Error ? e.message : "Failed", "danger");
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [toast]);

  const processAgain = useCallback(async () => {
    if (!id) return;
    await run("process", () => api(`/api/captures/${id}/process`, { body: {} }));
    await load();
    onChanged?.();
  }, [id, run, load, onChanged]);

  /** mode "full": the AI note plus the ticked tasks. mode "plain": your own words as a note, no tasks. */
  const accept = useCallback(async (mode: "full" | "plain"): Promise<{ noteId: string; tasks: number } | undefined> => {
    if (!capture || !draft) return undefined;
    const full = mode === "full";
    const related = full && draft.linkRelated && draft.related ? `\n\nRelated: [[${draft.related.title}]]` : "";
    const ticked = full ? draft.tasks.filter((t) => t.checked && t.title.trim()) : [];
    const r = await run("accept", () =>
      api<{ note: { id: string }; taskIds: string[] }>(`/api/captures/${capture.id}/accept`, {
        body: {
          title: draft.title.trim() || titleOf(capture),
          body: (full ? draft.body : capture.content) + related,
          summary: full ? draft.summary : "",
          category: full ? draft.category : "",
          tags: full ? draft.tags : [],
          project_ids: draft.projectId ? [draft.projectId] : [],
          tasks: ticked.map((t) => ({ title: t.title.trim(), due_date: t.due || null, project_id: draft.projectId || null })),
        },
      }),
    );
    if (!r) return undefined;
    onChanged?.();
    return { noteId: r.note.id, tasks: r.taskIds.length };
  }, [capture, draft, run, onChanged]);

  const dismiss = useCallback(async (): Promise<boolean> => {
    if (!capture) return false;
    const r = await run("dismiss", () => api(`/api/captures/${capture.id}`, { method: "PATCH", body: { status: "dismissed" } }));
    if (r === undefined) return false;
    onChanged?.();
    return true;
  }, [capture, run, onChanged]);

  const saveOriginal = useCallback(async () => {
    if (!capture) return;
    await run("patch", () => api(`/api/captures/${capture.id}`, { method: "PATCH", body: { content } }));
    toast("Capture updated", "ok");
    await load();
  }, [capture, content, run, load, toast]);

  return { capture, error, draft, setDraft, content, setContent, busy, reload: load, processAgain, accept, dismiss, saveOriginal, run };
}
