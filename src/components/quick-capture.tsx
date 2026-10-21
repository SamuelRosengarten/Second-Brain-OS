"use client";
import Link from "next/link";
import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { api } from "./client";
import { Button, Kbd, useToast } from "./ui";
import type { CreateCaptureResult } from "@/lib/captures";

/** Single-field capture for the dashboard. The note is saved first; AI processing is optional and separate. */
export function QuickCapture({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [process, setProcess] = useState(true);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<CreateCaptureResult | null>(null);

  async function save() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const isUrl = /^https?:\/\/\S+$/i.test(content);
      const r = await api<CreateCaptureResult>("/api/captures", {
        body: isUrl ? { kind: "link", url: content, content, process } : { kind: "idea", content, process },
      });
      setLast(r);
      if (!r.duplicate) setText("");
      toast(r.duplicate ? "Already captured" : process ? "Saved to inbox. Processing with local AI" : "Saved to inbox");
      onSaved?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface focus-within:border-accent/70">
      <textarea
        aria-label="Quick capture"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
        rows={2}
        placeholder="Capture an idea, task or link…"
        className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3.5 pt-3 pb-1 text-fg outline-none placeholder:text-faint"
      />
      <div className="flex flex-wrap items-center gap-3 px-3 pb-2.5 text-xs text-faint">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={process} onChange={(e) => setProcess(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
          Process with local AI
        </label>
        {last && !last.duplicate && (
          <Link href={`/inbox/${last.capture.id}`} className="text-accent hover:underline">Open last capture</Link>
        )}
        <Link href="/capture" className="hover:text-fg">Attach files or more options</Link>
        <span className="ml-auto hidden items-center gap-1 sm:flex"><Kbd>Ctrl</Kbd><Kbd>↵</Kbd></span>
        <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void save()}>
          <ArrowUp size={14} aria-hidden />
          Save
        </Button>
      </div>
    </div>
  );
}
