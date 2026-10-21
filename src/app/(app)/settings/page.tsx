"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/components/client";
import { Badge, Button, Card, CardTitle, ConfirmDialog, ErrorBox, Field, Input, Loading, PageHeader, Select, Textarea, useToast } from "@/components/ui";

interface Settings { chat_model: string; system_prompt: string; default_system_prompt: string }
interface Status {
  ollama: { ok: boolean; error?: string; models: { name: string }[] };
  chatModel: { name: string; installed: boolean };
  embedModel: { name: string; installed: boolean; total: number; embedded: number };
  dataDir: string;
}

/** Create / replace / revoke the capture-only token used by an iOS Shortcut. The plain token is shown once. */
function CaptureTokenCard() {
  const toast = useToast();
  const status = useApi<{ enabled: boolean; createdAt: string | null }>("/api/settings/capture-token");
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = typeof window === "undefined" ? "" : `${window.location.origin}/api/captures`;

  async function run(kind: "replace" | "revoke") {
    setBusy(true);
    try {
      if (kind === "revoke") {
        await api("/api/settings/capture-token", { method: "DELETE" });
        setFresh(null);
        toast("Capture token revoked");
      } else {
        const r = await api<{ token: string }>("/api/settings/capture-token", { method: "POST", body: {} });
        setFresh(r.token);
      }
      void status.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast("Could not copy automatically. Select the text and copy it by hand.", "danger");
    }
  }
  const enabled = status.data?.enabled ?? false;
  return (
    <Card className="space-y-3">
      <CardTitle action={status.data && <Badge tone={enabled ? "ok" : "neutral"}>{enabled ? "token active" : "no token"}</Badge>}>iPhone quick capture</CardTitle>
      <p className="text-sm text-muted">
        Lets an iOS Shortcut (for example from the Share sheet) send text and links straight to your inbox. The token can only create captures: it cannot read anything, sign in, or change settings.
        Changing your password or session secret also revokes it. Only use it over your private Tailscale address.
      </p>
      {status.error && <ErrorBox message={status.error} onRetry={() => void status.reload()} />}
      {enabled && status.data?.createdAt && !fresh && <p className="text-xs text-muted">Created {new Date(status.data.createdAt).toLocaleString()}. The token itself cannot be shown again; replace it if you lost it.</p>}
      {fresh && (
        <div className="space-y-3 rounded-lg border border-line bg-surface2 p-3">
          <p className="text-sm font-medium">Copy these into your Shortcut now. The token is shown only once.</p>
          <Field label="Token (header value: Bearer + this)">
            <div className="flex gap-2">
              <Input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button onClick={() => void copy(fresh, "Token")}>Copy</Button>
            </div>
          </Field>
          <Field label="Address to send captures to">
            <div className="flex gap-2">
              <Input readOnly value={endpoint} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button onClick={() => void copy(endpoint, "Address")}>Copy</Button>
            </div>
          </Field>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy && confirm === null} onClick={() => (enabled ? setConfirm("replace") : void run("replace"))}>{enabled ? "Replace token" : "Create token"}</Button>
        {enabled && <Button variant="danger" onClick={() => setConfirm("revoke")}>Revoke</Button>}
      </div>
      <details className="text-sm text-muted">
        <summary className="cursor-pointer text-fg">How to set up the Shortcut</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>In the Shortcuts app, create a shortcut and add <b>Get Contents of URL</b>.</li>
          <li>URL: the address above. Show More, then Method <b>POST</b>.</li>
          <li>Add a header <b>Authorization</b> with the value <code className="font-mono">Bearer</code> + a space + the token.</li>
          <li>Request Body <b>JSON</b>: add a Text field named <code className="font-mono">content</code> and set its value to <b>Shortcut Input</b>.</li>
          <li>In the shortcut&apos;s details, turn on <b>Show in Share Sheet</b> and accept text and URLs.</li>
        </ol>
        <p className="mt-2">Anything you share arrives in your Inbox. A link on its own is saved as a link.</p>
      </details>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "revoke" ? "Revoke the capture token?" : "Replace the capture token?"}
        message={confirm === "revoke" ? "Shortcuts using it will stop working until you create a new token." : "The current token stops working immediately. Update your Shortcut with the new one."}
        confirmLabel={confirm === "revoke" ? "Revoke" : "Replace"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void run(confirm)}
      />
    </Card>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const settings = useApi<Settings>("/api/settings");
  const status = useApi<Status>("/api/status");
  const backups = useApi<{ backups: { name: string; created: string }[] }>("/api/backup");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [theme, setTheme] = useState("system");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setModel(settings.data.chat_model);
      setPrompt(settings.data.system_prompt);
    }
  }, [settings.data]);
  useEffect(() => {
    try {
      setTheme(localStorage.getItem("sbos-theme") ?? "system");
    } catch { /* storage unavailable */ }
  }, []);

  function applyTheme(t: string) {
    setTheme(t);
    try {
      if (t === "system") {
        localStorage.removeItem("sbos-theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("sbos-theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch { /* ignore */ }
  }
  async function saveAi() {
    setBusy("ai");
    try {
      await api("/api/settings", { method: "PUT", body: { chat_model: model, system_prompt: prompt } });
      toast("Settings saved");
      void settings.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(null);
    }
  }
  async function dataAction(kind: "backup" | "export") {
    setBusy(kind);
    setResult(null);
    try {
      const r = await api<{ backup?: { dir: string; files: number }; export?: { dir: string; notes: number } }>(`/api/backup${kind === "export" ? "?export=1" : ""}`, { body: {} });
      setResult(r.backup ? `Backup created (${r.backup.files} files): ${r.backup.dir}` : `Exported ${r.export!.notes} notes to: ${r.export!.dir}`);
      void backups.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(null);
    }
  }
  async function logout() {
    await api("/api/auth/logout", { body: {} }).catch(() => undefined);
    window.location.href = "/login";
  }

  const installed = status.data?.ollama.models.map((m) => m.name) ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" />
      <Card className="space-y-3">
        <CardTitle action={<Button size="sm" variant="ghost" onClick={() => void status.reload()}>Recheck</Button>}>System status</CardTitle>
        {status.loading && !status.data && <Loading />}
        {status.data && (
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2"><Badge tone={status.data.ollama.ok ? "ok" : "danger"}>{status.data.ollama.ok ? "online" : "offline"}</Badge>Ollama {status.data.ollama.error && <span className="text-muted">— {status.data.ollama.error}</span>}</li>
            <li className="flex items-center gap-2"><Badge tone={status.data.chatModel.installed ? "ok" : "warn"}>{status.data.chatModel.installed ? "installed" : "missing"}</Badge>Chat model <code className="font-mono">{status.data.chatModel.name}</code>{!status.data.chatModel.installed && <code className="font-mono text-xs text-muted">ollama pull {status.data.chatModel.name}</code>}</li>
            <li className="flex items-center gap-2"><Badge tone={status.data.embedModel.installed ? "ok" : "warn"}>{status.data.embedModel.installed ? "installed" : "missing"}</Badge>Embedding model <code className="font-mono">{status.data.embedModel.name}</code>{status.data.embedModel.installed ? <span className="text-muted">{status.data.embedModel.embedded}/{status.data.embedModel.total} passages indexed</span> : <code className="font-mono text-xs text-muted">ollama pull {status.data.embedModel.name} (≈274 MB)</code>}</li>
            <li className="text-muted">Data folder: <code className="font-mono">{status.data.dataDir}</code></li>
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <CardTitle>AI</CardTitle>
        {settings.error && <ErrorBox message={settings.error} />}
        <Field label="Default chat model" hint="Also used for capture processing. Pick from models installed in Ollama.">
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {model && !installed.includes(model) && <option value={model}>{model} (not installed)</option>}
            {installed.map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="System prompt"><Textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
        <div className="flex gap-2">
          <Button variant="primary" loading={busy === "ai"} onClick={() => void saveAi()}>Save</Button>
          <Button variant="ghost" onClick={() => setPrompt(settings.data?.default_system_prompt ?? "")}>Reset prompt</Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <CardTitle>Backup &amp; export</CardTitle>
        <p className="text-sm text-muted">A backup is a plain folder with a database snapshot, your Markdown vault and attachments. Restoring is done from the command line with the app stopped (see docs/SETUP.md).</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={busy === "backup"} onClick={() => void dataAction("backup")}>Create backup</Button>
          <Button loading={busy === "export"} onClick={() => void dataAction("export")}>Export notes (Markdown + JSON)</Button>
        </div>
        {result && <p className="rounded-lg bg-surface2 p-3 font-mono text-xs break-all">{result}</p>}
        {(backups.data?.backups.length ?? 0) > 0 && <p className="text-xs text-muted">Existing backups: {backups.data!.backups.slice(0, 5).map((b) => b.name).join(", ")}</p>}
      </Card>

      <CaptureTokenCard />

      <Card className="space-y-3">
        <CardTitle>Appearance &amp; session</CardTitle>
        <Field label="Theme">
          <Select value={theme} onChange={(e) => applyTheme(e.target.value)}>
            <option value="system">Match system</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </Select>
        </Field>
        <Button variant="danger" onClick={() => void logout()}>Sign out</Button>
      </Card>
    </div>
  );
}
