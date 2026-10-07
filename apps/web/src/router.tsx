import { createBrowserRouter, type RouteObject } from "react-router";
import { AppLayout } from "./components/layout/AppLayout.js";
import { AuthGate, LoadingScreen, PublicGate } from "./components/layout/AuthGate.js";
import { PublicLayout } from "./components/layout/PublicLayout.js";
import { RouteError } from "./components/layout/RouteError.js";

/*
 * Every route here loads a page module from src/pages/<area>/..., which exports a component named
 * Component. A page owner edits only the files under their own page directory: the table below is
 * complete, so adding a page to an existing route never touches it.
 *
 * Directory rule: a route's page lives where its URL says, inside its area.
 *   /profiles -> pages/profiles      /profiles/new -> pages/profiles/new
 *   /profiles/:id -> pages/profiles/detail      /profiles/:id/mailbox -> pages/mailbox
 */

const appRoutes: RouteObject[] = [
  { index: true, lazy: () => import("./pages/dashboard/index.js") },
  { path: "profiles", lazy: () => import("./pages/profiles/index.js") },
  { path: "profiles/new", lazy: () => import("./pages/profiles/new/index.js") },
  { path: "profiles/:id", lazy: () => import("./pages/profiles/detail/index.js") },
  { path: "profiles/:id/mailbox", lazy: () => import("./pages/mailbox/index.js") },
  { path: "targets", lazy: () => import("./pages/targets/index.js") },
  { path: "targets/:id", lazy: () => import("./pages/targets/detail/index.js") },
  { path: "campaigns/new", lazy: () => import("./pages/campaigns/new/index.js") },
  { path: "requests", lazy: () => import("./pages/requests/index.js") },
  { path: "requests/:id", lazy: () => import("./pages/requests/detail/index.js") },
  { path: "review", lazy: () => import("./pages/review/index.js") },
  { path: "settings", lazy: () => import("./pages/settings/index.js") },
  { path: "settings/agents", lazy: () => import("./pages/settings/agents/index.js") },
  { path: "about", lazy: () => import("./pages/about/index.js") },
  // A living style guide for the components, only in development.
  ...(import.meta.env.DEV
    ? [{ path: "dev/ui", lazy: () => import("./pages/dev/ui/index.js") }]
    : []),
  { path: "*", lazy: () => import("./pages/not-found/index.js") },
];

export const routes: RouteObject[] = [
  {
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
