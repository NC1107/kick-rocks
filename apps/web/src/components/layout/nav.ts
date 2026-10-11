import {
  ClipboardCheck,
  Crosshair,
  LayoutDashboard,
  type LucideIcon,
  Send,
  Settings,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly, so "/" is not active on every page. */
  end?: boolean;
  /** Shows the count of things waiting on the person. */
  badge?: "review";
}

/** Review sits second because it is where the person acts; Settings holds everything set up once. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/review", label: "Review", icon: ClipboardCheck, badge: "review" },
  { to: "/requests", label: "Requests", icon: Send },
  { to: "/targets", label: "Targets", icon: Crosshair },
  { to: "/settings", label: "Settings", icon: Settings },
];
