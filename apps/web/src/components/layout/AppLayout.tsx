import { Menu } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { CurrentProfileProvider } from "../../api/index.js";
import { IconButton, Tag } from "../ui/index.js";
import { breadcrumbTrail } from "./breadcrumb.js";
import { BreadcrumbTailProvider, useBreadcrumbTailValue } from "./breadcrumb-context.js";
import { Drawer } from "./Drawer.js";
import { LogoMark } from "./Logo.js";
import { RouteAnnouncer } from "./RouteAnnouncer.js";
import { StatusChips, UrgentStatusMark, useShellStatus } from "./ShellStatus.js";
import { SidebarContent } from "./Sidebar.js";

const IS_MOCK = import.meta.env.MODE === "mock";

function Breadcrumb() {
  const { pathname } = useLocation();
  const trail = breadcrumbTrail(pathname, useBreadcrumbTailValue());
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 overflow-hidden">
      <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 overflow-hidden whitespace-nowrap p-0 text-meta">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          const label = (
            <span className={crumb.mono ? "font-mono text-meta" : undefined}>{crumb.label}</span>
          );
          return (
            <Fragment key={crumb.label}>
              {index > 0 ? (
                <li aria-hidden="true" className="text-ink-3">
                  /
                </li>
              ) : null}
              <li className={last ? "min-w-0 truncate font-medium text-ink" : "text-ink-3"}>
                {crumb.to && !last ? (
                  <Link
                    to={crumb.to}
                    className="rounded-xs transition-colors duration-100 hover:text-ink-2"
                  >
                    {label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined}>{label}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function HeaderBar() {
  const chips = useShellStatus();
  return (
    <header className="sticky top-0 z-20 hidden h-bar items-center justify-between gap-4 border-b border-line bg-rail px-gutter sm:flex">
      <Breadcrumb />
      <div className="flex shrink-0 items-center gap-3">
        <StatusChips chips={chips} />
        {IS_MOCK ? <Tag>Mock</Tag> : null}
      </div>
    </header>
  );
}

function PhoneBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const chips = useShellStatus();
  return (
    <header className="sticky top-0 z-20 flex h-bar items-center gap-2 border-b border-line bg-frame px-2 sm:hidden">
      <IconButton label="Open menu" onClick={onOpenMenu}>
        <Menu />
      </IconButton>
      <LogoMark />
      <div className="ml-auto flex items-center gap-2">
        {IS_MOCK ? <Tag>Mock</Tag> : null}
        <UrgentStatusMark chips={chips} />
      </div>
    </header>
  );
}

/**
 * The signed-in frame: a fixed rail and a header bar on wide screens, a top bar and drawer on a
 * phone. Pages render into <main>, left-aligned, and never need to know about either.
 */
export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  // The drawer closes itself on navigation; this also covers the back button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger, not an input
  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <CurrentProfileProvider>
      <BreadcrumbTailProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-ui focus:text-ink focus:shadow-pop"
        >
          Skip to content
        </a>

        <RouteAnnouncer />

        <aside className="fixed inset-y-0 left-0 z-30 hidden w-54 border-r border-line bg-rail sm:block">
          <SidebarContent />
        </aside>

        <div className="sm:pl-54">
          <HeaderBar />
          <PhoneBar onOpenMenu={() => setDrawerOpen(true)} />
          <main id="main" className="min-w-0 px-gutter py-5">
            <Outlet />
          </main>
        </div>

        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Menu">
          <SidebarContent
            onNavigate={() => setDrawerOpen(false)}
            onClose={() => setDrawerOpen(false)}
          />
        </Drawer>
      </BreadcrumbTailProvider>
    </CurrentProfileProvider>
  );
}
