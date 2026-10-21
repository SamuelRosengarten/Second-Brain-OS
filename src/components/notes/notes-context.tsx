"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useApi } from "../client";
import { ImportDialog, NewNoteDialog } from "./notes-dialogs";
import type { NoteMeta } from "@/lib/notes";
import type { SearchHit } from "@/lib/search";

export type Hit = Omit<SearchHit, "text">;
export interface SearchResponse { hits: Hit[]; semantic: { used: boolean; reason?: string } }
export interface EmbedStatus { name: string; installed: boolean; total: number; embedded: number }

interface NotesCtx {
  notes: NoteMeta[];
  loaded: boolean;
  error: string | null;
  tags: { tag: string; count: number }[];
  tag: string;
  setTag: (t: string) => void;
  sort: string;
  setSort: (s: string) => void;
  q: string;
  setQ: (q: string) => void;
  query: string;
  search: SearchResponse | null;
  searching: boolean;
  searchError: string | null;
  embed: EmbedStatus | undefined;
  reload: () => void;
  openNew: () => void;
  openImport: () => void;
  /** title (any case) -> note id, for [[wiki links]] */
  resolveTitle: (title: string) => string | undefined;
}
const Ctx = createContext<NotesCtx | null>(null);
export const useNotes = (): NotesCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNotes must be used inside NotesProvider");
  return c;
};

export function NotesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [query, setQuery] = useState((sp.get("q") ?? "").trim());
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("updated");
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(sp.get("new") === "1");
  const list = useApi<{ notes: NoteMeta[] }>(`/api/notes?sort=${sort}&limit=500${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`);
  const tagsApi = useApi<{ tags: { tag: string; count: number }[] }>("/api/tags");
  const status = useApi<{ embedModel: EmbedStatus }>("/api/status");

  // follow URL changes caused by the command palette (?q=…, ?new=1)
  const qParam = sp.get("q");
  const newParam = sp.get("new");
  useEffect(() => {
    if (qParam !== null) { setQ(qParam); setQuery(qParam.trim()); }
    if (newParam === "1") {
      setNewOpen(true);
      router.replace("/knowledge"); // drop ?new=1 right away so it can never race a later navigation
    }
  }, [qParam, newParam, router]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!query) { setSearch(null); return; }
    let cancelled = false;
    setSearching(true);
    api<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`)
      .then((r) => { if (!cancelled) { setSearch(r); setSearchError(null); } })
      .catch((e) => { if (!cancelled) setSearchError(e instanceof Error ? e.message : "Search failed"); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [query]);

  const notes = useMemo(() => list.data?.notes ?? [], [list.data]);
  const titles = useMemo(() => new Map(notes.map((n) => [n.title.toLowerCase(), n.id])), [notes]);
  const resolveTitle = useCallback((title: string) => titles.get(title.toLowerCase()), [titles]);
  const { reload: reloadList } = list;
  const { reload: reloadTags } = tagsApi;
  const { reload: reloadStatus } = status;
  const reload = useCallback(() => { void reloadList(); void reloadTags(); void reloadStatus(); }, [reloadList, reloadTags, reloadStatus]);

  const value = useMemo<NotesCtx>(
    () => ({
      notes, loaded: list.data !== null, error: list.error, tags: tagsApi.data?.tags ?? [], tag, setTag, sort, setSort, q, setQ, query, search, searching, searchError,
      embed: status.data?.embedModel, reload, openNew: () => setNewOpen(true), openImport: () => setImportOpen(true), resolveTitle,
    }),
    [notes, list.data, list.error, tagsApi.data, tag, sort, q, query, search, searching, searchError, status.data, reload, resolveTitle],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
      <NewNoteDialog open={newOpen} onClose={() => setNewOpen(false)} onDone={reload} />
    </Ctx.Provider>
  );
}
