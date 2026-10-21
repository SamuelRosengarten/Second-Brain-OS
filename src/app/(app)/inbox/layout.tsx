"use client";
import { useParams, usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { CaptureList, tabOf } from "@/components/inbox/capture-list";
import { InboxProvider, useInbox } from "@/components/inbox/inbox-context";
import { ErrorBox, ListSkeleton } from "@/components/ui";

/** Two panes on desktop (list on the left, the selected capture on the right); on a phone one at a time. */
function Split({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  const ib = useInbox();
  const selected = id ?? null;

  // Opening a capture from a link: show the tab it belongs to.
  const found = ib.captures.find((c) => c.id === selected);
  useEffect(() => { if (found) ib.setTab(tabOf(found)); }, [found?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col lg:-mx-10 lg:-mt-8 lg:-mb-12 lg:min-h-dvh lg:flex-row">
      <div className={`${selected ? "hidden lg:block" : "block"} w-full shrink-0 lg:w-[340px] lg:border-r lg:border-line lg:px-3.5 lg:py-7`}>
        {ib.error && <ErrorBox message={ib.error} onRetry={() => void ib.reload()} />}
        {!ib.loaded && !ib.error && <ListSkeleton rows={5} />}
        {ib.loaded && (
          <CaptureList items={ib.items} counts={ib.counts} selectedId={selected} tab={ib.tab} onTab={ib.setTab} q={ib.q} onQ={ib.setQ} onProcessAll={() => void ib.processAll()} processing={ib.processing} />
        )}
      </div>
      <div className={`${selected ? "flex" : "hidden lg:flex"} min-w-0 flex-1 flex-col lg:px-9 lg:py-7`}>{children}</div>
    </div>
  );
}

export default function InboxLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  // The phone review flow is full screen: no list around it.
  if (path === "/inbox/review") return <InboxProvider>{children}</InboxProvider>;
  return (
    <InboxProvider>
      <Split>{children}</Split>
    </InboxProvider>
  );
}
