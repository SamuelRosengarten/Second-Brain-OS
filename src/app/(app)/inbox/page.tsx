"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useInbox } from "@/components/inbox/inbox-context";
import { useNarrow } from "@/components/workflow/hooks";

/** Desktop: open the first capture straight away so the right pane is never empty. Phone: the list is the page. */
export default function InboxIndex() {
  const ib = useInbox();
  const router = useRouter();
  const narrow = useNarrow(1024);
  const first = ib.items[0]?.id;
  useEffect(() => {
    if (!narrow && first) router.replace(`/inbox/${first}`);
  }, [narrow, first, router]);
  if (!ib.loaded) return null;
  return (
    <div className="m-auto hidden max-w-sm flex-col items-center gap-2 px-6 py-16 text-center lg:flex">
      <p className="m-0 text-base font-medium">{ib.captures.length === 0 ? "Your inbox is empty" : "Nothing to open here"}</p>
      <p className="m-0 text-[13px] text-muted">
        {ib.captures.length === 0 ? "Capture a thought, task or link. It is saved immediately; your local model then drafts a title and tags for you to review." : "Pick another tab, or capture something new."}
      </p>
    </div>
  );
}
