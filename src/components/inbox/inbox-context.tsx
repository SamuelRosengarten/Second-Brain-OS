"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api, useApi } from "../client";
import { useToast } from "../ui";
import { countCaptures, filterCaptures, tabOf, type Tab } from "./capture-list";
import type { Capture } from "@/lib/captures";

interface InboxCtx {
  captures: Capture[];
  loaded: boolean;
  error: string | null;
  tab: Tab;
  setTab: (t: Tab) => void;
  q: string;
  setQ: (q: string) => void;
  items: Capture[];
  counts: Record<Tab, number>;
  reload: () => Promise<void>;
  processAll: () => Promise<void>;
  processing: boolean;
}
const Ctx = createContext<InboxCtx | null>(null);
export const useInbox = (): InboxCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useInbox must be used inside InboxProvider");
  return c;
};

export function InboxProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { data, error, reload } = useApi<{ captures: Capture[] }>("/api/captures");
  const [tab, setTab] = useState<Tab>("review");
  const [q, setQ] = useState("");
  const [processing, setProcessing] = useState(false);
  const captures = useMemo(() => data?.captures ?? [], [data]);
  const items = useMemo(() => filterCaptures(captures, tab, q), [captures, tab, q]);
  const counts = useMemo(() => countCaptures(captures), [captures]);

  const processAll = useCallback(async () => {
    setProcessing(true);
    try {
      const r = await api<{ run: { status: string; detail: string } }>("/api/jobs", { body: { job: "process-pending" } });
      toast(r.run.detail, r.run.status === "ok" ? "ok" : "danger");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setProcessing(false);
      await reload();
    }
  }, [reload, toast]);

  const value = useMemo<InboxCtx>(
    () => ({ captures, loaded: data !== null, error, tab, setTab, q, setQ, items, counts, reload: async () => { await reload(); }, processAll, processing }),
    [captures, data, error, tab, q, items, counts, reload, processAll, processing],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { tabOf };
