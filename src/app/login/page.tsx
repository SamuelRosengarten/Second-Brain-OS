"use client";
import { useState } from "react";
import { api } from "@/components/client";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { password } });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Second Brain <span className="text-accent">OS</span>
          </h1>
          <p className="mt-1 text-sm text-muted">Private instance. Sign in to continue.</p>
        </div>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} hint={error.includes("set-password") ? "npm run set-password" : undefined} />}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </main>
  );
}
