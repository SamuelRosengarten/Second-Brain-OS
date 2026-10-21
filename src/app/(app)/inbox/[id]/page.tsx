"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ReviewPane } from "@/components/inbox/review-pane";
import { useInbox } from "@/components/inbox/inbox-context";

export default function CapturePane() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const ib = useInbox();
  const idx = ib.items.findIndex((c) => c.id === id);
  const go = (to: string | undefined) => router.replace(to ? `/inbox/${to}` : "/inbox");
  const next = idx >= 0 ? ib.items[idx + 1]?.id : undefined;
  const prev = idx > 0 ? ib.items[idx - 1]?.id : undefined;

  return (
    <>
      <Link href="/inbox" className="mb-3 flex min-h-11 items-center gap-1 self-start text-base text-muted lg:hidden"><ChevronLeft size={20} aria-hidden />Inbox</Link>
      <ReviewPane
        key={id}
        id={id}
        position={idx >= 0 ? { index: idx + 1, total: ib.items.length } : undefined}
        onPrev={prev ? () => go(prev) : undefined}
        onNext={next ? () => go(next) : undefined}
        onChanged={() => void ib.reload()}
        onResolved={() => { const to = next ?? prev; void ib.reload().then(() => go(to)); }}
      />
    </>
  );
}
