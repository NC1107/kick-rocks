import { API_ROUTES } from "@kickrocks/shared";
import { LogOut, X } from "lucide-react";
import { NavLink } from "react-router";
import { useApiQuery, useCurrentProfile, useLogout, useReviewCount } from "../../api/index.js";
import { cn } from "../../lib/cn.js";
import { IconButton } from "../ui/index.js";
import { Logo } from "./Logo.js";
import { ABOUT_ITEM, NAV_GROUPS, type NavItem } from "./nav.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";
import { ThemeToggle } from "./ThemeToggle.js";

function ReviewCount({ count }: { count: number | null }) {
  if (!count) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-auto font-mono text-meta font-medium tabular-nums text-attention-text"
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
  trailing,
}: {
  item: NavItem;
  reviewCount: number | null;
  onNavigate: (() => void) | undefined;
  trailing?: string | undefined;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "marked group flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-ui font-medium transition-colors duration-100 max-sm:h-11",
          isActive ? "bg-accent-soft text-accent-text" : "text-ink-2 hover:bg-hover hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            aria-hidden="true"
            strokeWidth={1.5}
            className={cn(
              "size-4 shrink-0 transition-colors duration-100",
              isActive ? "text-accent-text" : "text-ink-3 group-hover:text-ink-2",
            )}
          />
          {item.label}
          {item.badge === "review" ? <ReviewCount count={reviewCount} /> : null}
          {trailing ? (
            <span className="ml-auto font-mono text-caption font-normal text-ink-3">
              {trailing}
            </span>
          ) : null}
        </>
      )}
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
  const health = useApiQuery(API_ROUTES.health);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The logo row is as tall as the header bar, so the two hairlines meet across the page. */}
      <div className="flex h-bar shrink-0 items-center justify-between gap-2 border-b border-line px-3.5">
        <Logo />
        {onClose ? (
          <IconButton label="Close menu" onClick={onClose} className="-mr-2">
            <X />
          </IconButton>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-2.5 pt-3 pb-2.5">
        <ProfileSwitcher onSwitch={onNavigate} />
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {NAV_GROUPS.map((group, index) => (
            <ul
              key={group.map((item) => item.to).join()}
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
        <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
          <NavRow
            item={ABOUT_ITEM}
            reviewCount={null}
            onNavigate={onNavigate}
            trailing={health.data ? `v${health.data.version}` : undefined}
          />
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <IconButton label="Sign out" onClick={() => logout.mutate()} loading={logout.isPending}>
              <LogOut />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
