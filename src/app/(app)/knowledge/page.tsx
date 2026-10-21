"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useNotes } from "@/components/notes/notes-context";
import { useNarrow } from "@/components/workflow/hooks";

/** Desktop: open the most recent note so the reader is never empty. Phone: the list is the page. */
export default function KnowledgeIndex() {
  const n = useNotes();
  const router = useRouter();
  const narrow = useNarrow(1024);
  const first = n.query ? undefined : n.notes[0]?.id;
  useEffect(() => {
    if (!narrow && first) router.replace(`/knowledge/${first}`);
  }, [narrow, first, router]);
  if (!n.loaded) return null;
  return (
    <div className="m-auto hidden max-w-sm flex-col items-center gap-2 px-6 py-16 text-center lg:flex">
      <p className="m-0 text-base font-medium">{n.notes.length === 0 ? "No notes yet" : "Pick a note"}</p>
      <p className="m-0 text-[13px] text-muted">{n.notes.length === 0 ? "Notes are plain Markdown files in your vault. Write one, import files, or accept a capture from the inbox." : "Choose one from the list, or search by words or meaning."}</p>
    </div>
  );
}
