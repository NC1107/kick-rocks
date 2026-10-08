import { QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { createMockApp, type MockApp, type MockAppOptions } from "../../mock/app.js";
import { CurrentProfileProvider } from "../api/current-profile.js";
import { createQueryClient } from "../api/query-client.js";
import { ToastProvider } from "../components/ui/index.js";

interface RenderPageOptions {
  /** Where the router starts, such as "/requests/req_0001". Defaults to "/". */
  route?: string;
  /** The path pattern the page sits at, so its `:params` resolve. Defaults to the whole app. */
  path?: string;
  /** The mock API that answers the page's calls. A fresh one is made when none is given. */
  mock?: MockApp;
  mockOptions?: MockAppOptions;
  /** Wrap the page in the current-profile provider, which the profile pages need. On by default. */
  withProfile?: boolean;
}

interface RenderedPage extends RenderResult {
  mock: MockApp;
  user: UserEvent;
}

/** Answers `fetch` from the mock API, so a page runs against the same handlers `dev:mock` serves. */
function stubFetch(mock: MockApp): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await mock.handle({
      method: init?.method ?? "GET",
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(response.body as BodyInit, {
      status: response.status,
      headers: response.headers,
    });
  });
}

/**
 * Renders a page the way the app does: inside a query client, a router, the toast provider, and
 * the current-profile provider, with `fetch` answered by the mock API.
 *
 *   const { user, mock } = renderPage(<Component />, { mockOptions: { auth: "login" } });
 *   await user.type(screen.getByLabelText("Password"), "wrong");
 */
export function renderPage(ui: ReactElement, options: RenderPageOptions = {}): RenderedPage {
  const mock = options.mock ?? createMockApp(options.mockOptions);
  stubFetch(mock);
  const page =
    options.withProfile === false ? ui : <CurrentProfileProvider>{ui}</CurrentProfileProvider>;
  const queryClient = createQueryClient();
  // A data router, like the app's, so pages can block navigation while there are unsaved edits.
  const router = createMemoryRouter(
    [
      { path: options.path ?? "*", element: page },
      { path: "/away", element: <p>Away page</p> },
      { path: "*", element: null },
    ],
    { initialEntries: [options.route ?? "/"] },
  );
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, mock, user: userEvent.setup() };
}
