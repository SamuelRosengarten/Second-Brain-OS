import { redirect } from "next/navigation";

// The Workflow page became Plan (Week, Timeline, Graph); keep old links and bookmarks working.
export default function WorkflowRedirect(): never {
  redirect("/plan?view=timeline");
}
