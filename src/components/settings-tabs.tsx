"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Segmented, segmentClass } from "./blocks";

/** Settings and Automations are one place in the sidebar ("Settings & automations"); this switches between them. */
export function SettingsTabs() {
  const path = usePathname();
  return (
    <Segmented label="Settings sections" className="mb-5">
      <Link href="/settings" aria-current={path === "/settings" ? "page" : undefined} className={segmentClass(path === "/settings")}>Settings</Link>
      <Link href="/automations" aria-current={path === "/automations" ? "page" : undefined} className={segmentClass(path === "/automations")}>Automations</Link>
    </Segmented>
  );
}
