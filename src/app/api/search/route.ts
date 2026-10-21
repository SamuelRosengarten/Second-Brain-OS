import { route } from "@/lib/api";
import { search } from "@/lib/search";

export const dynamic = "force-dynamic";
export const GET = route({}, async ({ url }) => {
  const q = url.searchParams.get("q") ?? "";
  const mode = url.searchParams.get("mode") === "keyword" ? "keyword" : "hybrid";
  const r = await search(q, { mode, limit: 20 });
  return {
    ...r,
    hits: r.hits.map((h) => {
      const { text: _text, ...rest } = h;
      void _text;
      return rest;
    }),
  };
});
