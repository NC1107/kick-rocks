import { House, Inbox, type LucideIcon, ScanSearch, Send, Settings } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly, so "/" is not active on every page. */
  end?: boolean;
  /** Shows the count of things waiting on the person. */
  badge?: "review";
}

/**
 * Findings sits second because it answers where the person is exposed; the Inbox is where they
 * act on mail and stopped tasks, and Settings holds everything set up once, the site catalogue
 * included.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/findings", label: "Findings", icon: ScanSearch },
  { to: "/requests", label: "Removals", icon: Send },
  { to: "/review", label: "Inbox", icon: Inbox, badge: "review" },
  { to: "/settings", label: "Settings", icon: Settings },
];
