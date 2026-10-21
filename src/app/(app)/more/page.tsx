import Link from "next/link";
import { PageHeader } from "@/components/ui";

const ITEMS = [
  { href: "/knowledge", label: "Knowledge", note: "Notes, import and search" },
  { href: "/projects", label: "Projects", note: "Goals, tasks and linked notes" },
  { href: "/tasks", label: "Tasks", note: "Everything to do" },
  { href: "/ai", label: "AI Workspace", note: "Local chat and Claude handoff" },
  { href: "/automations", label: "Automations", note: "Manual jobs and run history" },
  { href: "/settings", label: "Settings", note: "Models, backup, theme, sign out" },
];

export default function MorePage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="More" />
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {ITEMS.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex items-center justify-between px-4 py-3.5 hover:bg-surface2">
              <span>
                <span className="block font-medium">{i.label}</span>
                <span className="text-xs text-muted">{i.note}</span>
              </span>
              <span aria-hidden className="text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
