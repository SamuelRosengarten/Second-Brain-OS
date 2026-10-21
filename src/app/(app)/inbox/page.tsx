"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { fmtDate, useApi } from "@/components/client";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, Select } from "@/components/ui";
import type { Capture } from "@/lib/captures";

const statusTone = (s: string) => (s === "failed" ? "danger" : s === "proposed" ? "accent" : s === "accepted" ? "ok" : s === "processing" ? "warn" : "neutral") as "danger" | "accent" | "ok" | "warn" | "neutral";
const STATUS_LABEL: Record<string, string> = { new: "Unprocessed", processing: "Processing", proposed: "Needs review", accepted: "Saved", dismissed: "Dismissed", failed: "Failed" };

function InboxList() {
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (debounced) qs.set("q", debounced);
  if (archived) qs.set("archived", "1");
  const { data, error, loading, reload } = useApi<{ captures: Capture[] }>(`/api/captures?${qs}`);
  const items = data?.captures ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Inbox" subtitle="Everything you capture lands here first." actions={<Link href="/capture"><Button variant="primary">New capture</Button></Link>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
        <Input type="search" aria-label="Search inbox" placeholder="Search captures…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Archived
        </label>
      </div>
      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading />}
      {data && items.length === 0 && (
        <EmptyState title={q || status || archived ? "No captures match" : "Your inbox is empty"} action={!q && !status && !archived ? <Link href="/capture"><Button variant="primary">Capture something</Button></Link> : undefined}>
          {q || status || archived ? "Try clearing the filters." : "Capture an idea, link or document. It is saved immediately, then optionally organised by your local AI."}
        </EmptyState>
      )}
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id}>
            <Link href={`/inbox/${c.id}`}>
              <Card className="transition-colors hover:border-muted">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.proposal?.title ?? (c.content.replace(/\s+/g, " ").slice(0, 90) || "(empty)")}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{c.proposal?.summary ?? c.content}</p>
                  </div>
                  <Badge tone={statusTone(c.status)}>{STATUS_LABEL[c.status]}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{fmtDate(c.created_at)}</span>
                  <Badge>{c.kind.replace("_", " ")}</Badge>
                  {c.attachments.length > 0 && <Badge>{c.attachments.length} file{c.attachments.length > 1 ? "s" : ""}</Badge>}
                  {c.proposal?.tags.slice(0, 4).map((t) => <Badge key={t} tone="accent">#{t}</Badge>)}
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InboxList />
    </Suspense>
  );
}
