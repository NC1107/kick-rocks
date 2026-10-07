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

/** Review sits second because it is where the person acts; setup lives apart from daily work. */
export const NAV_GROUPS: readonly (readonly NavItem[])[] = [
  [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/review", label: "Review", icon: ClipboardCheck, badge: "review" },
    { to: "/requests", label: "Requests", icon: Send },
    { to: "/targets", label: "Targets", icon: Crosshair },
  ],
  [
    { to: "/profiles", label: "Profiles", icon: Users },
    { to: "/settings", label: "Settings", icon: Settings },
  ],
];

/** Pinned to the bottom of the rail with the version. */
export const ABOUT_ITEM: NavItem = { to: "/about", label: "About", icon: Info };
