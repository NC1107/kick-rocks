import {
  ClipboardCheck,
  Crosshair,
  Info,
  LayoutDashboard,
  type LucideIcon,
  Send,
  Settings,
  Users,
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

/** Day-to-day work first, then the things you set up once. */
export const NAV_GROUPS: readonly (readonly NavItem[])[] = [
  [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/targets", label: "Targets", icon: Crosshair },
    { to: "/requests", label: "Requests", icon: Send },
    { to: "/review", label: "Review", icon: ClipboardCheck, badge: "review" },
  ],
  [
    { to: "/profiles", label: "Profiles", icon: Users },
    { to: "/settings", label: "Settings", icon: Settings },
    { to: "/about", label: "About", icon: Info },
  ],
];
