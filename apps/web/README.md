# apps/web

The Kick Rocks web app: React 19, react-router, @tanstack/react-query, Tailwind v4, and lucide icons.
This file is for people building pages.
The shell (router, layout, tokens, components, API client, mock API) is finished, so a page owner only edits files inside their own page directories and their own mock files.

## Run it

```sh
export PATH="$HOME/.local/bin:$PATH"
pnpm --filter @kickrocks/web dev:mock --port 5180
```

`dev:mock` answers `/api/*` from `mock/`, so no server is needed.
It starts signed in as "Jordan Example".
The mock password is `kickrocks-mock`.
`pnpm --filter @kickrocks/web dev` proxies `/api` to the real server on port 8420 instead.

Open `/dev/ui` in development for a living style guide: every component and state, in the current theme.
Use it to check a change in light and dark, and at phone width.

## Add a page

Every route is already in `src/router.tsx`, pointing at a page module.
A page lives where its URL says, inside its area:

| Route | Page file |
|---|---|
| `/setup` | `src/pages/setup/index.tsx` |
| `/login` | `src/pages/login/index.tsx` |
| `/` | `src/pages/dashboard/index.tsx` |
| `/profiles` | `src/pages/profiles/index.tsx` |
| `/profiles/new` | `src/pages/profiles/new/index.tsx` |
| `/profiles/:id` | `src/pages/profiles/detail/index.tsx` |
| `/profiles/:id/mailbox` | `src/pages/mailbox/index.tsx` |
| `/targets` | `src/pages/targets/index.tsx` |
| `/targets/:id` | `src/pages/targets/detail/index.tsx` |
| `/campaigns/new` | `src/pages/campaigns/new/index.tsx` |
| `/requests` | `src/pages/requests/index.tsx` |
| `/requests/:id` | `src/pages/requests/detail/index.tsx` |
| `/review` | `src/pages/review/index.tsx` |
| `/settings` | `src/pages/settings/index.tsx` |
| `/settings/agents` | `src/pages/settings/agents/index.tsx` |
| `/about` | `src/pages/about/index.tsx` |

Replace the stub in the file.
The module must export a component named `Component`, which is how the router lazy-loads it.
Put the page's own pieces next to it, in the same directory, and never edit `router.tsx`.

```tsx
import { API_ROUTES } from "@kickrocks/shared";
import { useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import { Alert, PageHeader, StatusMark } from "../../components/ui/index.js";

export function Component() {
  return (
    <RequireProfile>
      {(profile) => <Requests profileId={profile.id} />}
    </RequireProfile>
  );
}
```

`PageHeader` sets the browser tab title, so a page never has to.
`RequireProfile` shows a skeleton while profiles load, a "create a profile" empty state when there are none, and otherwise calls its child with the current profile.
`useCurrentProfile()` returns the same profile anywhere under the layout, and `setProfileId` switches it.

## Call the API

`src/api` is built from the route table in `packages/shared/src/api.ts`.
Params, query, and body are typed from each route's schema.
Every response is parsed with the route's response schema, so a server that breaks the contract fails loudly.
`X-Kick-Rocks: 1` is sent on every state-changing call.
A 401 from a signed-in route ends the session and shows `/login`, so a page never handles it.

```tsx
const targets = useApiQuery(API_ROUTES.targetsList, { query: { kind: "broker", page } });
const detail = useApiQuery(API_ROUTES.targetsGet, id ? { params: { id } } : skipToken);

const cancel = useApiMutation(API_ROUTES.requestsAct, {
  invalidates: [API_ROUTES.requestsList, API_ROUTES.requestsGet, API_ROUTES.dashboardGet],
  onSuccess: () => toast.success("Request cancelled"),
});
cancel.mutate({ params: { id }, body: { action: "cancel" } });
```

- A query value may be an array for a comma list, such as `status: ["sent", "queued"]`.
- `keepPrevious: true` keeps the old page of a list on screen while the next one loads.
- On a failed mutation, `error.fieldErrors` maps validation issues by dotted path, such as `identities.0.value.address`, for a `Field`'s `error` prop.
- `errorMessage(error)` gives text that is safe to show for any error.
- `screenshotUrl(taskId)` is the `src` for a task screenshot.
- `reviewCount`, `useAuthState`, and the profile hooks already exist.

## Components

Everything is in `src/components/ui`, exported from one index.
Spacing, color, and type come from tokens (below), not from raw Tailwind palette colors, which are switched off.

| Component | Use it for |
|---|---|
| `Button`, `LinkButton`, `IconButton` | Actions. One primary per view. `loading` blocks clicks and shows a spinner. An `IconButton` needs a `label`. |
| `Field` | Wrap one control with its label, help, and error. The control gets its id and `aria-describedby` from it. |
| `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup` | Form controls. `Select` is the native element. |
| `Card`, `CardHeader`, `CardFooter` | Group related content. Structure is a hairline, not a shadow. |
| `Tag` | A fact about a row: a category, a requirement. Outlined, never tinted. |
| `StatusMark`, `TaskStatusMark` | Request and task state: a shape and a word. |
| `Table` and its parts, `Pagination` | Lists. The table scrolls inside its frame on a phone. Show an `EmptyState` instead of a table with no rows. |
| `Tabs`, `LinkTabs` | `Tabs` for panels on one page, `LinkTabs` for sections that are routes. |
| `Dialog`, `ConfirmDialog` | Native modal: focus trap, Escape, focus return. Use `ConfirmDialog` with `destructive` before anything irreversible. |
| `useToast()` | Confirm what just happened, with the verb of the button: "Delete" gives "Deleted". |
| `Alert` | A notice that stays in the page. |
| `EmptyState`, `Skeleton`, `Spinner` | Nothing here, loading with a shape, loading without one. |
| `PageHeader` | Title, description, actions, optional back link. |
| `Menu` | A short list of actions, with a `selected` flag on items that choose one of several. |
| `CopyButton`, `CodeBlock` | Copy a value or command. Copy works over plain http on a LAN. |
| `DescriptionList`, `TextLink`, `ExternalLinkText` | Labelled facts and links. |

Display words for enums live in `src/lib/labels.ts`, and the request status table lives in `src/lib/status.ts`.
Use them, so a value reads the same on every page.

## Design tokens

Defined in `src/index.css` as CSS variables for light and dark, then mapped into Tailwind's theme.
Light and dark follow the system through `prefers-color-scheme`, and the sidebar toggle stores an override in `localStorage` (`kickrocks.theme`).
Tailwind's own palette is removed, so a class such as `bg-red-500` does not exist.

- Surfaces: `canvas`, `surface`, `raised`, `sunken`, `sidebar`, `field`.
- Lines: `line` for hairlines, `line-strong` for the edge of a control (3:1 against its surface).
- Text: `ink`, `ink-muted`, `ink-faint`.
- Accent: `accent`, `accent-hover`, `accent-ink`, `accent-soft`, `accent-soft-ink`, plus `danger` for destructive actions.
- Tones: set `data-tone` to `neutral`, `positive`, `attention` or `danger` and use `bg-tone-bg text-tone-ink`, `border-tone-line`, `text-tone-dot`.
- Type: system font stack, 12, 13, 14, 16, 18, 22, and 28 px, with 14 px as body.
- Radius by role: `xs` checkbox, `sm` badge, `md` control, `lg` card, `xl` dialog.
- Only floating layers get a shadow: `shadow-pop` and `shadow-dialog`.
- Controls are 36 px tall (`h-control`), 44 px on a phone.

Every text and control-edge pair meets WCAG AA in both themes.
No font or asset loads from a third party.

## The mock API

`mock/` holds one file per domain, answering the routes of the shared table.
The server validates every handler's params, query, body, and response against the shared schemas, so a bad fixture answers 500 with the schema issues instead of confusing a page.
It also behaves like the real server where a UI can notice: 401 when signed out, 403 without `X-Kick-Rocks`, 400 with issues, 409 for an illegal transition, and 429 after five wrong passwords.

| File | Owner | Answers |
|---|---|---|
| `mock/auth.ts` | web-core | `/auth/*` |
| `mock/profiles.ts` | web-core | `/profiles*` |
| `mock/mailbox.ts` | web-core | `/mail/providers`, `/profiles/:id/mailbox*` |
| `mock/dashboard.ts` | web-core | `/profiles/:id/dashboard` |
| `mock/about.ts` | web-core | `/health`, `/settings/data-sources` |
| `mock/targets.ts` | web-flows | `/targets*` |
| `mock/campaigns.ts` | web-flows | `/profiles/:id/campaigns*` |
| `mock/requests.ts` | web-flows | `/profiles/:id/requests`, `/requests/*` |
| `mock/review.ts` | web-flows | `/review`, `/tasks/*`, `/matches/*`, `/messages/*`, `/profiles/:id/scans` |
| `mock/settings.ts` | web-flows | `/settings*` except data sources, `/recipes*` |

To add or change a handler, edit your own file.
A handler is typed from the route, so the compiler tells you the response shape:

```ts
handle(API_ROUTES.targetsGet, ({ params }) => {
  const target = store.targets.find((candidate) => candidate.id === params.id);
  if (!target) throw notFound("That target");
  return target;
}),
```

- `seed(store)` fills the shared store. Domains seed in the order listed in `mock/registry.ts`, so requests can read the targets and profiles seeded before them.
- State lives in memory. Saving any file under `mock/` reloads the mock and re-seeds it on the next request.
- `POST /__mock/reset` puts the fixtures back, and `GET /__mock/auth?mode=login|setup|authed` jumps the session to a state to test the auth gate.
- `KICKROCKS_MOCK_LATENCY` sets the delay in milliseconds, 150 by default, and `KICKROCKS_MOCK_AUTH` sets where the mock starts.
- Fixtures use fictional brokers on `.example` domains and fake people on `example.com`. A test fails on anything else, and on an em dash.
- The worker API is not mocked, because the web app never calls it.
- `mock/mock.test.ts` fails when a route of the shared table has no handler, so a new route cannot be forgotten.

## Checks

```sh
pnpm --filter @kickrocks/web typecheck
pnpm --filter @kickrocks/web test
pnpm --filter @kickrocks/web build
```
