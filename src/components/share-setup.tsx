"use client";
import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useApi } from "./client";
import { Button, Card, CardTitle, useToast } from "./ui";

interface ShareInfo { enabled: boolean; token: string }

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const toast = useToast();
  const [shown, setShown] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied`, "ok");
    } catch {
      toast("Could not copy. Select the text and copy it by hand.", "danger");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted">{label}</span>
      <code className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-xs break-all">{secret && !shown ? "•".repeat(24) : value}</code>
      {secret && (
        <Button size="sm" variant="ghost" aria-label={shown ? `Hide ${label}` : `Show ${label}`} aria-pressed={shown} onClick={() => setShown((v) => !v)}>
          {shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        </Button>
      )}
      <Button size="sm" aria-label={`Copy ${label}`} onClick={() => void copy()}><Copy size={14} aria-hidden />Copy</Button>
    </div>
  );
}

/** Everything the iPhone Shortcut needs, ready to copy, so nothing has to be typed from a README. */
export function ShareSetupCard() {
  const info = useApi<ShareInfo>("/api/settings/share");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Card className="space-y-3">
      <CardTitle>iPhone share sheet</CardTitle>
      {!info.data ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : !info.data.enabled ? (
        <p className="text-sm text-muted">
          Share-sheet capture is switched off. Add <code>SBOS_CAPTURE_TOKEN=&lt;32+ random characters&gt;</code> to <code>.env.local</code> and restart the app (the README shows a one-line command that generates it). The token can only add captures to your inbox.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">Safari cannot share straight into a web app, so a tiny Shortcut does it. Open the Shortcuts app on your iPhone, create a shortcut with one <strong>Get Contents of URL</strong> action, and fill it in with these values (use this page from the iPhone to copy them):</p>
          <div className="space-y-2">
            <CopyRow label="URL" value={`${origin}/api/share`} />
            <CopyRow label="Method" value="POST" />
            <CopyRow label="Header 1 name" value="Authorization" />
            <CopyRow label="Header 1 value" value={`Bearer ${info.data.token}`} secret />
            <CopyRow label="Header 2 name" value="X-SBOS" />
            <CopyRow label="Header 2 value" value="1" />
          </div>
          <p className="text-sm text-muted">Request body: <strong>JSON</strong> with two text fields, <code>text</code> = Shortcut Input and <code>title</code> = Shortcut Input&rsquo;s Name. Then turn on <strong>Show in Share Sheet</strong> and allow Safari web pages, URLs and Text. Shared items arrive in your Inbox.</p>
        </>
      )}
    </Card>
  );
}
