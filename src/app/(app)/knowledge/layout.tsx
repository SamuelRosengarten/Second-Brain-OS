"use client";
import { useParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { NotesProvider } from "@/components/notes/notes-context";
import { NotesList } from "@/components/notes/notes-list";

/** List on the left, the open note (and its connections) on the right. On a phone, one at a time. */
function Split({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  const selected = id ?? null;
  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col lg:-mx-10 lg:-mt-8 lg:-mb-12 lg:min-h-dvh lg:flex-row">
      <div className={`${selected ? "hidden lg:block" : "block"} w-full shrink-0 lg:w-[310px] lg:border-r lg:border-line lg:px-3.5 lg:py-7`}>
        <NotesList selectedId={selected} />
      </div>
      <div className={`${selected ? "flex" : "hidden lg:flex"} min-w-0 flex-1 flex-col`}>{children}</div>
    </div>
  );
}

export default function KnowledgeLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <NotesProvider>
        <Split>{children}</Split>
      </NotesProvider>
    </Suspense>
  );
}
