import { redirect } from "next/navigation";

// Search now lives at the top of Notes (it searches by words and by meaning); keep old links working.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<never> {
  const { q } = await searchParams;
  redirect(q ? `/knowledge?q=${encodeURIComponent(q)}` : "/knowledge");
}
