"use client";
import { useEffect, useState, type RefObject } from "react";

/** The element's current content width in px (re-measured when the window or the element resizes). 0 until mounted. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** True when the viewport is narrower than `px` (phones). false on the server and before mount. */
export function useNarrow(px = 768): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return narrow;
}

/** localStorage-backed value that never throws (private mode, blocked storage). */
export function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered; harmless
  }
}
