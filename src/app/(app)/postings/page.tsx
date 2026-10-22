"use client";
import { useEffect, useState } from "react";
import { Check, Clock, ExternalLink, Mail, Settings2, Trash2, X } from "lucide-react";
import { api, fmtDate, useApi } from "@/components/client";
import { Badge, Button, Dialog, EmptyState, ErrorBox, Input, PageHeader, Tabs, Textarea, useToast, cx } from "@/components/ui";
import { buildDraft, composeMailto, cvSkillsIn, draftMailto, gmailCompose } from "@/lib/scout-draft";

interface P {
  id: string; company: string; title: string; url: string; url_type: "posting" | "search_page"; score: number | null; dates_note: string;
  technologies: string; status: string; recruiter_email: string | null; email_source_url: string | null; draft_text: string; first_seen_at: string;
}
interface Saved extends Omit<P, "status" | "first_seen_at"> { saved_at: string }
interface Schedule { enabled: boolean; times: string[]; days: number[]; last_fired: string | null }
interface Run { id: string; status: string; found: number; added: number; error: string | null; started_at: string }
interface Data { postings: P[]; saved: Saved[]; schedule: Schedule; nextRun: string | null; draftTo: string | null; runs: Run[] }
type Tab = "review" | "accepted" | "saved";
type Target = { kind: "accepted" | "saved"; id: string } | null;

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function Avatar({ name }: { name: string }) {
  const h = hue(name);
  return (
    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl text-lg font-semibold" style={{ background: `hsl(${h} 40% 22%)`, color: `hsl(${h} 85% 80%)` }}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function FitMeter({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`Fit ${score} out of 5`}>
      <span aria-hidden className="inline-flex gap-[3px]">
        {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cx("h-3.5 w-1.5 rounded-sm", i <= score ? (score >= 4 ? "bg-ok" : "bg-accent") : "bg-line")} />)}
      </span>
      <span className="font-mono text-[11px] text-muted">{score}/5</span>
    </span>
  );
}

function Listing({ p, mode, onAccept, onDeny, onEmail, onSave }: { p: P | Saved; mode: Tab; onAccept?: () => void; onDeny?: () => void; onEmail?: () => void; onSave?: () => void }) {
  const techs = p.technologies.split(/,\s*/).filter(Boolean).slice(0, 8);
  const when = "saved_at" in p ? `Saved ${fmtDate(p.saved_at)}` : `Found ${fmtDate(p.first_seen_at)}`;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 transition-colors hover:border-faint/50">
      <div className="flex items-start gap-3">
        <Avatar name={p.company} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] leading-snug font-semibold">{p.title}</h2>
          <p className="text-[13px] text-muted">{p.company}</p>
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
          {p.score != null && <FitMeter score={p.score} />}
          <span className="text-[11px] text-faint">{when}</span>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 sm:hidden">
        {p.score != null ? <FitMeter score={p.score} /> : <span />}
        <span className="text-[11px] text-faint">{when}</span>
      </div>
      {!p.recruiter_email && mode === "review" && <div className="mt-3"><Badge tone="neutral">No public email: you apply on their website</Badge></div>}
      {p.url_type === "search_page" && <div className="mt-3"><Badge tone="warn">Search page only, not the exact posting</Badge></div>}
      {p.dates_note && <p className="mt-3 text-[13px] leading-relaxed text-muted">{p.dates_note}</p>}
      {techs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {techs.map((t) => {
            const match = cvSkillsIn(t).length > 0;
            return <span key={t} className={cx("rounded-md border px-2 py-0.5 text-xs", match ? "border-ok/40 bg-ok/10 text-ok" : "border-line text-muted")} title={match ? "On your CV" : undefined}>{t}</span>;
          })}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
          <ExternalLink size={14} aria-hidden /> Open posting
        </a>
        <span className="ml-auto flex flex-wrap gap-2">
          {mode === "review" && onDeny && <Button size="sm" variant="ghost" onClick={onDeny}><X size={15} aria-hidden /> Deny</Button>}
          {mode === "review" && onAccept && <Button size="sm" variant="primary" onClick={onAccept}><Check size={15} aria-hidden /> Accept</Button>}
          {mode === "accepted" && !p.recruiter_email && onSave && <Button size="sm" variant="ghost" onClick={onSave}><Trash2 size={14} aria-hidden /> Remove &amp; save</Button>}
          {mode !== "review" && p.recruiter_email && onEmail && <Button size="sm" onClick={onEmail}><Mail size={15} aria-hidden /> Email draft</Button>}
          {mode !== "review" && !p.recruiter_email && <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-primary px-3 text-[13px] font-semibold text-primary-fg hover:bg-primary-hover lg:h-8"><ExternalLink size={14} aria-hidden /> Apply on the website</a>}
        </span>
      </div>
    </div>
  );
}

function EmailDialog({ p, kind, draftTo, onClose, onSaved, onChanged }: { p: P | Saved; kind: "accepted" | "saved"; draftTo: string | null; onClose: () => void; onSaved: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(p.draft_text);
  const [busy, setBusy] = useState(false);
  const dirty = text !== p.draft_text;
  const readOnly = kind === "saved";

  async function saveEdits() {
    setBusy(true);
    try {
      await api(`/api/postings/${p.id}`, { method: "PATCH", body: { draft_text: text } });
      toast("Draft saved", "ok");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }
  async function removeAndSave() {
    setBusy(true);
    try {
      if (dirty) await api(`/api/postings/${p.id}`, { method: "PATCH", body: { draft_text: text } });
      await api(`/api/postings/${p.id}`, { body: { action: "save" } });
      toast("Removed from the list and saved", "ok");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} wide title={`Email draft · ${p.company}`} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        <p className="text-xs">
          <span className="text-faint">Real recipient: </span>
          {p.recruiter_email
            ? <>{p.recruiter_email}{p.email_source_url && <> (source: <a className="underline" href={p.email_source_url} target="_blank" rel="noopener noreferrer">page</a>)</>}</>
            : "none found publicly. Apply through the posting page, or keep “Madame, Monsieur”."}
        </p>
        <Textarea rows={14} value={text} readOnly={readOnly} onChange={(e) => setText(e.target.value)} aria-label="Email draft" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { void navigator.clipboard.writeText(text); toast("Copied", "ok"); }}>Copy text</Button>
          <a className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-primary px-3 text-[13px] font-semibold text-primary-fg hover:bg-primary-hover lg:h-8" href={gmailCompose(p, text)} target="_blank" rel="noopener noreferrer"><Mail size={14} aria-hidden /> Review &amp; send in Gmail</a>
          <a className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line px-3 text-[13px] font-medium hover:bg-hover lg:h-8" href={composeMailto(p, text)}>Other mail app</a>
          {draftTo
            ? <a className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line px-3 text-[13px] font-medium hover:bg-hover lg:h-8" href={draftMailto({ ...p, draft_text: text }, draftTo)}><Mail size={14} aria-hidden /> Draft to myself</a>
            : <span className="self-center text-xs text-faint">Set SBOS_DRAFT_TO in .env.local to get the mail-app link.</span>}
          {!readOnly && dirty && <Button size="sm" variant="primary" loading={busy} onClick={() => void saveEdits()}>Save changes</Button>}
        </div>
        <p className="text-xs text-faint">“Review &amp; send in Gmail” opens a Gmail compose window with the message filled in (addressed to the recruiter when a public address was found). You attach your CV and press Send yourself; nothing is sent for you. “Draft to myself” sends the text to your own address instead.</p>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Button size="sm" variant="danger" loading={busy} onClick={() => void removeAndSave()}><Trash2 size={14} aria-hidden /> Remove &amp; save</Button>
            <span className="text-xs text-faint">Takes it off this list and keeps it under Saved.</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const DAYS: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
const PRESETS: [string, string][] = [["Morning", "08:00"], ["Lunchtime", "12:00"], ["3 pm", "15:00"], ["Evening", "18:00"]];

function ScheduleDialog({ initial, nextRun, onClose, onSaved }: { initial: Schedule; nextRun: string | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [times, setTimes] = useState(initial.times);
  const [days, setDays] = useState(initial.days);
  const [busy, setBusy] = useState(false);
  const valid = times.length > 0 && times.every((t) => /^\d\d:\d\d$/.test(t)) && days.length > 0;

  async function save() {
    setBusy(true);
    try {
      await api("/api/postings/schedule", { method: "PUT", body: { enabled, times, days } });
      toast(enabled ? "Schedule saved" : "Automation is off", "ok");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
      setBusy(false);
    }
  }
  const addTime = (t: string) => setTimes((cur) => (cur.includes(t) || cur.length >= 6 ? cur : [...cur, t].sort()));

  return (
    <Dialog open onClose={onClose} title="Scout settings" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-5">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line p-3">
          <span>
            <span className="block text-sm font-medium text-fg">Run the scout automatically</span>
            <span className="block text-xs text-faint">
              {enabled
                ? (initial.enabled && nextRun ? `Next run: ${new Date(nextRun).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "Starts once you press Save")
                : "Off. You can still press Run scout yourself."}
            </span>
          </span>
          <input type="checkbox" className="size-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </label>

        <fieldset className="space-y-2">
          <legend className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg"><Clock size={13} aria-hidden /> Times (this PC&apos;s clock)</legend>
          <div className="flex flex-wrap gap-2">
            {times.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <Input type="time" aria-label={`Time ${i + 1}`} value={t} className="w-28" onChange={(e) => setTimes((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />
                {times.length > 1 && <button type="button" aria-label={`Remove ${t}`} className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg" onClick={() => setTimes((cur) => cur.filter((_, j) => j !== i))}><X size={14} aria-hidden /></button>}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([label, t]) => (
              <button key={t} type="button" disabled={times.includes(t) || times.length >= 6} onClick={() => addTime(t)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg disabled:opacity-40">+ {label} {t}</button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-fg">Days</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([d, label]) => {
              const on = days.includes(d);
              return <button key={d} type="button" aria-pressed={on} onClick={() => setDays((cur) => (on ? cur.filter((x) => x !== d) : [...cur, d]))} className={cx("h-8 rounded-lg border px-3 text-xs font-medium", on ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:bg-hover")}>{label}</button>;
            })}
          </div>
          <div className="flex gap-3 text-xs">
            <button type="button" className="text-accent hover:underline" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>Every day</button>
            <button type="button" className="text-accent hover:underline" onClick={() => setDays([1, 2, 3, 4, 5])}>Weekdays</button>
          </div>
        </fieldset>

        <p className="text-xs leading-relaxed text-faint">
          The schedule runs only while this app&apos;s server is running on your PC. A run missed by under 15 minutes still happens when it starts again. Every run uses your Anthropic API credit.
          When new results arrive, the postings you did not decide on are replaced. Accepted ones are kept.
        </p>
      </div>
    </Dialog>
  );
}

export default function PostingsPage() {
  const toast = useToast();
  const { data, error, reload } = useApi<Data>("/api/postings");
  const [tab, setTab] = useState<Tab>("review");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Target>(null);
  const [settings, setSettings] = useState(false);

  // Keep the page current: scheduled runs land while it is open.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  async function scout() {
    setBusy(true);
    try {
      const r = await api<{ run: { status: string; detail: string } }>("/api/jobs", { body: { job: "run-scout" } });
      toast(r.run.status === "ok" ? r.run.detail : `Scout failed: ${r.run.detail}`, r.run.status === "ok" ? "ok" : "danger");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setBusy(false);
      void reload();
    }
  }
  async function decide(p: P, action: "accept" | "deny") {
    try {
      if (action === "accept") {
        // No public recruiter email: no draft, just the link to apply on their website.
        if (!p.recruiter_email) {
          await api(`/api/postings/${p.id}`, { body: { action } });
          toast("Accepted. Apply on their website from the Accepted tab.", "ok");
          await reload();
          setTab("accepted");
          return;
        }
        await api(`/api/postings/${p.id}`, { body: { action, draft: p.draft_text || buildDraft(p, data?.draftTo ?? null) } });
        await reload();
        setTarget({ kind: "accepted", id: p.id });
      } else {
        await api(`/api/postings/${p.id}`, { body: { action } });
        toast("Removed", "ok");
        void reload();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  async function saveAway(id: string) {
    try {
      await api(`/api/postings/${id}`, { body: { action: "save" } });
      toast("Removed from the list and saved", "ok");
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }
  async function deleteSaved(id: string) {
    try {
      await api(`/api/postings/saved/${id}`, { method: "DELETE" });
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    }
  }

  const all = data?.postings ?? [];
  const review = all.filter((p) => p.status === "new");
  const accepted = all.filter((p) => p.status !== "new");
  const saved = data?.saved ?? [];
  const last = data?.runs[0];
  const open = target && (target.kind === "accepted" ? accepted.find((p) => p.id === target.id) : saved.find((p) => p.id === target.id));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Internship postings"
        subtitle="Found by your cloud agent. Accept the ones you want; nothing is ever sent for you."
        actions={
          <>
            <Button onClick={() => setSettings(true)}><Settings2 size={15} aria-hidden /> Scout settings</Button>
            <Button variant="primary" loading={busy} onClick={() => void scout()}>Run scout</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {last && <span>Last run {fmtDate(last.started_at)}: {last.status === "error" ? `failed (${last.error})` : `${last.found} found, ${last.added} new`}</span>}
        {data?.schedule.enabled && data.nextRun && <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden /> Next automatic run {new Date(data.nextRun).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>}
      </div>

      <Tabs<Tab> label="Postings" value={tab} onChange={setTab} tabs={[{ id: "review", label: "To review", count: review.length }, { id: "accepted", label: "Accepted", count: accepted.length }, { id: "saved", label: "Saved", count: saved.length }]} />

      {error && <ErrorBox message={error} />}
      {data && tab === "review" && review.length === 0 && <EmptyState title="Nothing to review">Press “Run scout” or set it to run on a schedule.</EmptyState>}
      {data && tab === "accepted" && accepted.length === 0 && <EmptyState title="No accepted postings">Postings you accept show up here with their email draft.</EmptyState>}
      {data && tab === "saved" && saved.length === 0 && <EmptyState title="Nothing saved yet">Accepted postings are archived here, and stay even after the list is refreshed.</EmptyState>}

      <ul className="space-y-3">
        {tab === "review" && review.map((p) => <li key={p.id}><Listing p={p} mode="review" onAccept={() => void decide(p, "accept")} onDeny={() => void decide(p, "deny")} /></li>)}
        {tab === "accepted" && accepted.map((p) => <li key={p.id}><Listing p={p} mode="accepted" onEmail={() => setTarget({ kind: "accepted", id: p.id })} onSave={() => void saveAway(p.id)} /></li>)}
        {tab === "saved" && saved.map((p) => (
          <li key={p.id} className="space-y-1">
            <Listing p={p} mode="saved" onEmail={() => setTarget({ kind: "saved", id: p.id })} />
            <div className="text-right"><button type="button" className="text-xs text-faint hover:text-danger hover:underline" onClick={() => void deleteSaved(p.id)}>Delete permanently</button></div>
          </li>
        ))}
      </ul>

      {target && open && (
        <EmailDialog key={target.id} p={open} kind={target.kind} draftTo={data?.draftTo ?? null} onClose={() => setTarget(null)} onChanged={() => void reload()} onSaved={() => { setTarget(null); void reload(); }} />
      )}
      {settings && data && <ScheduleDialog initial={data.schedule} nextRun={data.nextRun} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); void reload(); }} />}
    </div>
  );
}
