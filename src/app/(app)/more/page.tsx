import Link from "next/link";
import { ChevronRight, FileText, FolderKanban, ListTodo, Settings, Sparkles, Waypoints, Workflow } from "lucide-react";
import { PageHeader, RowList, rowClass } from "@/components/ui";

const ITEMS = [
  { href: "/knowledge", label: "Notes", note: "Your Markdown library, import and search", icon: FileText },
  { href: "/tasks", label: "Tasks", note: "Everything to do", icon: ListTodo },
  { href: "/projects", label: "Projects", note: "Goals, tasks and linked notes", icon: FolderKanban },
  { href: "/workflow", label: "Workflow", note: "Timeline, dependencies and graph", icon: Waypoints },
  { href: "/ai", label: "Ask AI", note: "Local chat and Claude handoff", icon: Sparkles },
  { href: "/automations", label: "Automations", note: "Manual jobs and run history", icon: Workflow },
  { href: "/settings", label: "Settings", note: "Models, backup, theme, sign out", icon: Settings },
];

export default function MorePage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="More" />
      <RowList>
        {ITEMS.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={`${rowClass} min-h-14`}>
              <i.icon size={18} aria-hidden strokeWidth={1.75} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{i.label}</span>
                <span className="block text-xs text-faint">{i.note}</span>
              </span>
              <ChevronRight size={16} aria-hidden className="text-faint" />
            </Link>
          </li>
        ))}
      </RowList>
    </div>
  );
}
