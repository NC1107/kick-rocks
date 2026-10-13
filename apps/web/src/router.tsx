import { createBrowserRouter, Navigate, Outlet, type RouteObject, useLocation } from "react-router";
import { AppLayout } from "./components/layout/AppLayout.js";
import { AuthGate, LoadingScreen, PublicGate } from "./components/layout/AuthGate.js";
import { PublicLayout } from "./components/layout/PublicLayout.js";
import { RouteError } from "./components/layout/RouteError.js";
import { ToastProvider } from "./components/ui/index.js";

/*
 * Every route here loads a page module from src/pages/<area>/..., which exports a component named
 * Component. A page owner edits only the files under their own page directory: the table below is
 * complete, so adding a page to an existing route never touches it.
 *
 * Directory rule: a route's page lives where its URL says, inside its area.
 *   /settings/profiles -> pages/settings/profiles      /profiles/new -> pages/profiles/new
 *   /profiles/:id -> pages/profiles/detail      /profiles/:id/mailbox -> pages/mailbox
 */

/** The old listings address keeps its ?show= filter, which the findings page still understands. */
function LegacyListings() {
  return <Navigate to={{ pathname: "/findings", search: useLocation().search }} replace />;
}

export const appRoutes: RouteObject[] = [
  { index: true, lazy: () => import("./pages/dashboard/index.js") },
  { path: "profiles", element: <Navigate to="/settings/profiles" replace /> },
  { path: "profiles/new", lazy: () => import("./pages/profiles/new/index.js") },
  { path: "profiles/:id", lazy: () => import("./pages/profiles/detail/index.js") },
  { path: "profiles/:id/mailbox", lazy: () => import("./pages/mailbox/index.js") },
  { path: "targets", lazy: () => import("./pages/targets/index.js") },
  { path: "findings", lazy: () => import("./pages/findings/index.js") },
  { path: "targets/listings", element: <LegacyListings /> },
  { path: "targets/:id", lazy: () => import("./pages/targets/detail/index.js") },
  { path: "targets/:id/remove", lazy: () => import("./pages/targets/remove/index.js") },
  { path: "campaigns/new", lazy: () => import("./pages/campaigns/new/index.js") },
  { path: "requests", lazy: () => import("./pages/requests/index.js") },
  { path: "requests/:id", lazy: () => import("./pages/requests/detail/index.js") },
  { path: "review/*", lazy: () => import("./pages/review/index.js") },
  { path: "settings", lazy: () => import("./pages/settings/index.js") },
  { path: "settings/recipes", lazy: () => import("./pages/settings/recipes/index.js") },
  { path: "settings/advanced", lazy: () => import("./pages/settings/advanced/index.js") },
  { path: "settings/agents", element: <Navigate to="/settings#helpers" replace /> },
  {
    path: "settings/notifications",
    lazy: () => import("./pages/settings/notifications/index.js"),
  },
  { path: "settings/profiles", lazy: () => import("./pages/settings/profiles/index.js") },
  { path: "settings/about", lazy: () => import("./pages/settings/about/index.js") },
  { path: "about", element: <Navigate to="/settings/about" replace /> },
  // A living style guide for the components, only in development.
  ...(import.meta.env.DEV
    ? [{ path: "dev/ui", lazy: () => import("./pages/dev/ui/index.js") }]
    : []),
  { path: "*", lazy: () => import("./pages/not-found/index.js") },
];

/** Inside the router, so a toast can link to the page it is about. */
function ToastRoot() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

const routes: RouteObject[] = [
  {
    element: <ToastRoot />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <LoadingScreen />,
    children: [
      {
        element: <PublicGate page="setup" />,
        children: [
          {
            element: <PublicLayout />,
            children: [{ path: "setup", lazy: () => import("./pages/setup/index.js") }],
          },
        ],
      },
      {
        element: <PublicGate page="login" />,
        children: [
          {
            element: <PublicLayout />,
            children: [{ path: "login", lazy: () => import("./pages/login/index.js") }],
          },
        ],
      },
      {
        element: <AuthGate />,
        children: [{ element: <AppLayout />, children: appRoutes }],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
