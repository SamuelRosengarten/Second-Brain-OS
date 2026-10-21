import { redirect } from "next/navigation";

// The Pipeline page became the Workflow page; keep old links and bookmarks working.
export default function PipelineRedirect(): never {
  redirect("/plan");
}
