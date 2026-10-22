"use client";
import { useEffect, useState } from "react";
import { ApiFailure, api } from "./client";

/**
 * Captures made while the server cannot be reached wait here, in this browser, and are sent as soon as it can.
 * Text, links and tasks only: a file cannot be kept safely in localStorage, so those still need a connection.
 */
const KEY = "sbos.capture-queue";
const EVENT = "sbos-queue";

export interface QueuedCapture { id: string; fields: Record<string, string>; queuedAt: string }

function read(): QueuedCapture[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as QueuedCapture[]) : [];
  } catch {
    return [];
  }
}
function write(items: QueuedCapture[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVENT));
}

export function queueCapture(fields: Record<string, string>): void {
  write([...read(), { id: crypto.randomUUID(), fields, queuedAt: new Date().toISOString() }]);
}

let flushing: Promise<number> | null = null;

/** Sends what is waiting, oldest first. Stops at the first connection failure; returns how many went through. */
export function flushQueue(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of read()) {
      const form = new FormData();
      for (const [k, v] of Object.entries(item.fields)) form.set(k, v);
      try {
        await api("/api/captures", { form });
      } catch (e) {
        // A rejected capture (bad input) would block the queue forever, so it is dropped; anything else is retried later.
        const rejected = e instanceof ApiFailure && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
        if (!rejected) break;
      }
      write(read().filter((q) => q.id !== item.id));
      sent += 1;
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

/** How many captures are waiting on this device, kept current across tabs and after each send. */
export function useQueuedCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const sync = () => setN(read().length);
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return n;
}
