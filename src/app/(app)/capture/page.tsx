"use client";
import { CaptureForm } from "@/components/capture-form";
import { Card, PageHeader } from "@/components/ui";

export default function CapturePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Capture" subtitle="Saved to your inbox immediately; AI processing never risks the original." />
      <Card>
        <CaptureForm />
      </Card>
    </div>
  );
}
