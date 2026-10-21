"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Archive, CircleCheck, Circle, Inbox as InboxIcon, LoaderCircle, PenLine, Search, Sparkles, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useApi } from "@/components/client";
import { Badge, Button, EmptyState, ErrorBox, Input, ListSkeleton, PageHeader, rowClass, RowList, Tabs } from "@/components/ui";
import type { Capture } from "@/lib/captures";

type Filter = "all" | "proposed" | "new" | "processing" | "failed" | "accepted" | "dismissed";
const LABEL: Record<Capture["status"], string> = { new: "Unprocessed", processing: "Processing", proposed: "Needs review", accepted: "Saved", dismissed: "Dismissed", failed: "Failed" };
const ICON: Record<Capture["status"], { icon: LucideIcon; cls: string }> = {
  new: { icon: Circle, cls: "text-faint" },
  processing: { icon: LoaderCircle, cls: "text-warn animate-spin" },
  proposed: { icon: Sparkles, cls: "text-accent" },
  accepted: { icon: CircleCheck, cls: "text-ok" },
  dismissed: { icon: X, cls: "text-faint" },
  failed: { icon: TriangleAlert, cls: "text-danger" },
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function InboxList() {
  const sp = useSearchParams();
  const initial = sp.get("status");
  const [filter, setFilter] = useState<Filter>((["proposed", "new", "failed", "accepted"].includes(initial ?? "") ? initial : "all") as Filter);
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useApi<{ captures: Capture[] }>(`/api/captures${archived ? "?archived=1" : ""}`);
  const all = data?.captures ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const x of all) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [all]);
  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((c) => (filter === "all" || c.status === filter) && (!term || `${c.content} ${c.url} ${c.proposal?.title ?? ""} ${c.proposal?.summary ?? ""} ${c.proposal?.tags.join(" ") ?? ""}`.toLowerCase().includes(term)));
  }, [all, filter, q]);

  const tabs: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "proposed", label: "Needs review", count: counts.proposed ?? 0 },
    { id: "new", label: "Unprocessed", count: counts.new ?? 0 },
    ...((counts.processing ?? 0) > 0 ? [{ id: "processing" as const, label: "Processing", count: counts.processing }] : []),
    ...((counts.failed ?? 0) > 0 ? [{ id: "failed" as const, label: "Failed", count: counts.failed }] : []),
    { id: "accepted", label: "Saved", count: counts.accepted ?? 0 },
    ...((counts.dismissed ?? 0) > 0 ? [{ id: "dismissed" as const, label: "Dismissed", count: counts.dismissed }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={archived ? "Inbox · Archived" : "Inbox"}
        subtitle="Captures are saved before any AI runs. Review suggestions, then save them as notes."
        actions={
          <>
            <Button variant="ghost" onClick={() => setArchived((a) => !a)} aria-pressed={archived}>
              <Archive size={14} aria-hidden />
              {archived ? "Back to inbox" : "Archived"}
            </Button>
            <Link href="/capture"><Button variant="primary"><PenLine size={14} aria-hidden />New capture</Button></Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs label="Filter by status" value={filter} onChange={setFilter} tabs={tabs} />
        <div className="relative min-w-48 flex-1 sm:max-w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <Input type="search" aria-label="Search inbox" placeholder="Filter captures…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {loading && !data && <ListSkeleton />}
      {data && items.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          title={q || filter !== "all" || archived ? "No captures match" : "Your inbox is empty"}
          action={!q && filter === "all" && !archived ? <Link href="/capture"><Button variant="primary">Capture something</Button></Link> : undefined}
        >
          {q || filter !== "all" || archived ? "Try another filter or clear the search." : "Capture an idea, link or document. It is saved immediately, then optionally organised by your local AI."}
        </EmptyState>
      )}
      {items.length > 0 && (
        <RowList>
          {items.map((c) => {
            const { icon: Icon, cls } = ICON[c.status];
            const title = c.proposal?.title ?? (c.content.replace(/\s+/g, " ").slice(0, 100) || "(empty)");
            return (
              <li key={c.id}>
                <Link href={`/inbox/${c.id}`} className={`${rowClass} items-start`}>
                  <Icon size={16} aria-label={LABEL[c.status]} role="img" className={`mt-0.5 shrink-0 ${cls}`} strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{c.proposal?.summary ?? c.content}</p>
                    {c.status === "failed" && <p className="mt-0.5 line-clamp-1 text-xs text-danger">{c.error}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge>{c.kind.replace("_", " ")}</Badge>
                      {c.attachments.length > 0 && <Badge>{c.attachments.length} file{c.attachments.length > 1 ? "s" : ""}</Badge>}
                      {c.proposal?.tags.slice(0, 3).map((t) => <span key={t} className="text-xs text-faint">#{t}</span>)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tnum text-xs text-faint">{ago(c.created_at)}</span>
                    {c.status === "proposed" && <Badge tone="accent">Review</Badge>}
                    {c.status === "failed" && <Badge tone="danger">Retry</Badge>}
                  </div>
                </Link>
              </li>
            );
          })}
        </RowList>
      )}
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <InboxList />
    </Suspense>
  );
}
