"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CaptureForm } from "@/components/capture-form";
import { Card, PageHeader } from "@/components/ui";

/** Shared text arrives as ?title=&text=&url= (web share target). A lone link in `text` is treated as the link. */
function prefill(p: URLSearchParams): { content: string; url: string } {
  const title = (p.get("title") ?? "").trim();
  let text = (p.get("text") ?? "").trim();
  let url = (p.get("url") ?? "").trim();
  if (!url && /^https?:\/\/\S+$/i.test(text)) {
    url = text;
    text = "";
  }
  return { content: [title, text].filter((s, i, all) => s && all.indexOf(s) === i).join("\n\n"), url };
}

function CaptureBody() {
  const params = useSearchParams();
  return (
    <Card>
      <CaptureForm initial={prefill(params)} />
    </Card>
  );
}

export default function CapturePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Capture" subtitle="Saved to your inbox immediately; AI processing never risks the original." />
      <Suspense fallback={<Card>Loading…</Card>}>
        <CaptureBody />
      </Suspense>
    </div>
  );
}
