"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ymd } from "@/lib/dates";

export class ApiFailure extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** fetch wrapper: adds the CSRF header, parses JSON errors, redirects to /login on 401. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-sbos": "1" };
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiFailure(0, "Cannot reach the Second Brain OS server. Is it running?", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) window.location.href = "/login";
  if (!res.ok) throw new ApiFailure(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`, (data as { code?: string }).code ?? "error");
  return data as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: iso.length > 10 ? "short" : undefined });
};

/** Today on THIS device's calendar. Sent to the API so the phone and the PC agree on what is "today". */
export const localToday = (): string => ymd();

/**
 * An unsent draft kept in this browser's localStorage, so a reload, a dropped connection or a switch of app on the
 * phone does not lose what was typed. Restored after mount (never during render, so server and client markup match).
 * `empty` must be a stable object (module constant). Storage can be unavailable; everything then just works without it.
 */
export function useDraft<T extends Record<string, string>>(key: string, empty: T, significant: (keyof T & string)[] = Object.keys(empty)) {
  const [value, setValue] = useState<T>(empty);
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  // A draft only counts when a "significant" field holds something (a changed dropdown alone is not worth restoring).
  const sig = significant.join("|");
  const blank = useCallback((v: T) => sig.split("|").every((k) => v[k].trim() === empty[k].trim()), [empty, sig]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<T>;
        const next = { ...empty };
        for (const k of Object.keys(empty)) if (typeof parsed[k] === "string") (next as Record<string, string>)[k] = parsed[k] as string;
        if (!blank(next)) {
          setValue(next);
          setRestored(true);
        }
      }
    } catch {
      /* storage unavailable or corrupt: start empty */
    }
    setReady(true);
  }, [key, empty, blank]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      try {
        if (blank(value)) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [key, value, ready, blank]);

  /** Forget the draft (after it was saved, or when the user discards it). */
  const clear = useCallback(() => {
    setValue(empty);
    setRestored(false);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key, empty]);

  return { value, setValue, restored, dismissRestored: () => setRestored(false), clear };
}

/** What to tell the user when a save fails: a dropped connection keeps the draft, which is worth saying. */
export const saveFailureMessage = (e: unknown): string => {
  if (e instanceof ApiFailure && e.code === "network") return `${e.message} Your text is kept on this device.`;
  return e instanceof Error ? e.message : "Could not save";
};
