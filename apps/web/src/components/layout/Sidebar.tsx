import { LogOut, X } from "lucide-react";
import { NavLink } from "react-router";
import { useCurrentProfile, useLogout, useReviewCount } from "../../api/index.js";
import { cn } from "../../lib/cn.js";
import { Badge, IconButton } from "../ui/index.js";
import { Logo } from "./Logo.js";
import { NAV_GROUPS, type NavItem } from "./nav.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";
import { SitesChip } from "./SitesChip.js";
import { ThemeToggle } from "./ThemeToggle.js";

function ReviewCount({ count }: { count: number | null }) {
  if (!count) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-accent-ink"
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">{count === 1 ? "1 item waiting" : `${count} items waiting`}</span>
    </>
  );
}

function NavRow({
  item,
  reviewCount,
  onNavigate,
}: {
  item: NavItem;
  reviewCount: number | null;
  onNavigate: (() => void) | undefined;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex h-control items-center gap-2.5 rounded-md px-2.5 text-base transition-colors duration-100",
          isActive
            ? "bg-accent-soft font-medium text-accent-soft-ink"
            : "text-ink-muted hover:bg-sunken hover:text-ink",
        )
      }
    >
      <Icon aria-hidden="true" className="size-4.5 shrink-0" strokeWidth={1.75} />
      {item.label}
      {item.badge === "review" ? <ReviewCount count={reviewCount} /> : null}
    </NavLink>
  );
}

/** The navigation, profile switcher, and account controls. Shared by the desktop rail and the phone drawer. */
export function SidebarContent({
  onNavigate,
  onClose,
}: {
  onNavigate?: () => void;
  /** Given in the phone drawer, which needs an explicit way out. */
  onClose?: () => void;
}) {
  const { profile } = useCurrentProfile();
  const reviewCount = useReviewCount(profile?.id ?? null);
  const logout = useLogout();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-3 py-4">
      <div className="flex items-center justify-between gap-2 px-1.5 pt-0.5">
        <Logo />
        {onClose ? (
          <IconButton label="Close menu" onClick={onClose} className="-mr-1.5">
            <X />
          </IconButton>
        ) : null}
      </div>
      <ProfileSwitcher onSwitch={onNavigate} />
      <nav
        aria-label="Main"
        className="-mx-1.5 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1.5 py-1"
      >
        {NAV_GROUPS.map((group, index) => (
          <ul
            key={group.map((item) => item.to).join()}
            // The second group sits below a hairline: setup lives apart from daily work.
            className={cn(
              "m-0 flex list-none flex-col gap-0.5 p-0",
              index > 0 && "border-t border-line pt-3",
            )}
          >
            {group.map((item) => (
              <li key={item.to}>
                <NavRow item={item} reviewCount={reviewCount} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        ))}
      </nav>
      <div className="flex flex-col gap-2.5 border-t border-line pt-3">
        <SitesChip onNavigate={onNavigate} />
        {import.meta.env.MODE === "mock" ? (
          <Badge tone="amber" className="self-start">
            Mock data
          </Badge>
        ) : null}
        <div className="flex items-center justify-between">
          <ThemeToggle />
          <IconButton label="Sign out" onClick={() => logout.mutate()} loading={logout.isPending}>
            <LogOut />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
