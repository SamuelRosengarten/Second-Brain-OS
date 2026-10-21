"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ReviewFlow } from "@/components/inbox/review-flow";
import { useNarrow } from "@/components/workflow/hooks";

/** Phone: one capture at a time. On a wide screen the Inbox already is the review, so go there. */
export default function ReviewPage() {
  const router = useRouter();
  const narrow = useNarrow(1024);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) router.replace("/inbox");
  }, [router, narrow]);
  return <ReviewFlow />;
}
