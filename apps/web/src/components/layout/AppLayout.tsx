import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { CurrentProfileProvider } from "../../api/index.js";
import { IconButton } from "../ui/index.js";
import { Drawer } from "./Drawer.js";
import { Logo } from "./Logo.js";
import { SidebarContent } from "./Sidebar.js";

/**
 * The signed-in frame: a fixed rail on wide screens, a top bar and drawer on a phone. Pages render
 * into <main> and never need to know about either.
 */
export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  // The drawer closes itself on navigation; this also covers the back button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger, not an input
  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <CurrentProfileProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-base focus:text-ink focus:shadow-pop"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-line bg-sidebar md:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-sidebar px-2 md:hidden">
        <IconButton label="Open menu" onClick={() => setDrawerOpen(true)}>
          <Menu />
        </IconButton>
        <Logo />
      </header>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Menu">
        <SidebarContent
          onNavigate={() => setDrawerOpen(false)}
          onClose={() => setDrawerOpen(false)}
        />
      </Drawer>

      <main id="main" className="min-w-0 md:pl-60">
        <div className="mx-auto w-full max-w-6xl px-gutter py-6 md:py-8">
          <Outlet />
        </div>
      </main>
    </CurrentProfileProvider>
  );
}
