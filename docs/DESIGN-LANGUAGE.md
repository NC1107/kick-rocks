# Kick Rocks design language

This is the spec for the web UI in `apps/web`.
The direction in one line: a quiet instrument panel for one person's privacy, with tonal dark layers, one rationed accent, monospace for every number and identifier, and rows instead of cards.
`apps/web/src/index.css` holds the token values, and a change to a token starts here.

## Color

- Dark is the reference theme and the default when the OS gives no preference.
- Light ships too, because the app supports both schemes and follows the OS setting.
- One accent, split into four roles: `accent-fill` (primary button, selected tab underline, active nav tab), `accent-on` (text on the fill), `accent-text` (links and accent glyphs), `accent-soft` (active nav and selection wash).
- Accent is allowed in exactly these places: primary button, links, active nav item, selected tab, focus ring, row selection, checkbox and radio fill, meter fill, the text selection wash, and the logo tile.
  Status marks never use accent: Sent and Awaiting reply are rings in `ink-2` with a centre dot.
  Anything else using accent is a bug.
- State uses four semantic families only: positive, attention, danger, and neutral.
  No other hues exist.
- Text is never pure white on dark.
- Hex values are the source of truth, with an `-rgb` triplet for each semantic color so washes and halos can take their own alpha.

**Accent choice.**
The accent is indigo `#5557E0`.
It is rationed, never used in a gradient, never tints surfaces, and stays this darkened hex rather than Tailwind's `#6366F1`.

**Dark tokens.**

| Token | Hex | Use |
|---|---|---|
| `--kr-frame` | `#0A0A0B` | page behind everything, phone top bar |
| `--kr-rail` | `#0F0F10` | sidebar, header bar |
| `--kr-canvas` | `#141415` | content area |
| `--kr-surface` | `#1C1C1E` | row groups, tables, panels |
| `--kr-hover` | `#232326` | row and control hover |
| `--kr-active` | `#27272A` | pressed, toggle off, meter track |
| `--kr-field` | `#0F0F10` | inputs and selects, darker than the surface so they read as inset |
| `--kr-popover` | `#2B2B31` | menus, popovers, tooltips |
| `--kr-popover-hover` | `#303037` | menu item hover, 1.07:1 against the popover, so a focused menu item also takes an inset 2px focus ring |
| `--kr-line` | `#27272A` | hairlines, row dividers |
| `--kr-line-popover` | `#45454E` | popover and dialog edge |
| `--kr-line-strong` | `#6B6B75` | control edges, 3.2:1 on surface |
| `--kr-ink` | `#EDEDEF` | primary text |
| `--kr-ink-2` | `#BEBEC4` | secondary text, 9.2:1 on surface and at least 7.1:1 on every layer |
| `--kr-ink-3` | `#9898A4` | muted text, labels, 6.0:1 on surface and at least 4.6:1 on every layer (lowest on popover hover) |
| `--kr-accent-fill` | `#5557E0` | primary fill, white text at 5.5:1 |
| `--kr-accent-fill-hover` | `#6466E8` | primary hover |
| `--kr-accent-on` | `#FFFFFF` | text on the fill |
| `--kr-accent-text` | `#8F98F9` | links, active nav label and icon, 6.5:1 on surface and at least 5.0:1 on every layer |
| `--kr-accent-soft` | `#1C1C2D` | active nav and selection wash (accent at 12% on canvas) |
| `--kr-focus` | `#818CF8` | 2px focus outline |
| `--kr-positive` | `#22C55E` | dot and shape fill |
| `--kr-positive-text` | `#4ADE80` | positive text, 9.8:1 on surface and at least 7.5:1 on every layer |
| `--kr-attention` | `#F59E0B` | dot and shape fill |
| `--kr-attention-text` | `#FBBF24` | attention text, 10.2:1 on surface and at least 7.8:1 on every layer |
| `--kr-danger` | `#EF4444` | dot, outlined danger button edge |
| `--kr-danger-text` | `#FA8080` | danger text, 6.9:1 on surface and at least 5.3:1 on every layer |
| `--kr-danger-wash-text` | `#FCA5A5` | text on a danger wash |
| `--kr-danger-solid` / `--kr-danger-on` | `#DC2626` / `#FFFFFF` | the confirm dialog's final button in both schemes, white on red at 4.8:1 |
| `--kr-scrim` | `rgba(0,0,0,0.55)` | dialog backdrop |

**Light tokens** (cool slate, with muted text lifted for AA).

| Token | Hex | Note |
|---|---|---|
| `--kr-frame` | `#EFF1F3`  | |
| `--kr-rail` | `#EFF1F3`  | |
| `--kr-canvas` | `#F7F8F9`  | |
| `--kr-surface` | `#FFFFFF`  | |
| `--kr-hover` | `#F0F2F4` | one step down from surface |
| `--kr-active` | `#E6E9ED` | pressed, meter track |
| `--kr-field` | `#FFFFFF` | with `line-strong` edge |
| `--kr-popover` | `#FFFFFF` | with `line-popover` edge and the menu shadow |
| `--kr-popover-hover` | `#F0F2F4` | |
| `--kr-line` | `#DCE0E5`  | |
| `--kr-line-popover` | `#C9CED5` | stronger edge for floating layers |
| `--kr-line-strong` | `#858A8F` | 3.5:1 on white |
| `--kr-ink` | `#1B1E22` | 16.7:1 on white |
| `--kr-ink-2` | `#474D55` | 8.5:1 on white, a real step above ink-3 |
| `--kr-ink-3` | `#5D646D` | 6.0:1 on white and at least 4.9:1 on every layer, 5.3:1 on the rail |
| `--kr-accent-fill` | `#4648D4` | `#5557E0` darkened, white text at 6.7:1 |
| `--kr-accent-fill-hover` | `#3B3DC0` | |
| `--kr-accent-on` | `#FFFFFF` | |
| `--kr-accent-text` | `#4648D4` | 6.7:1 on white |
| `--kr-accent-soft` | `#ECECFC` | accent text on it at 5.7:1 |
| `--kr-focus` | `#4648D4` | |
| `--kr-positive` / `-text` | `#16A34A` / `#146C37` | text 6.5:1 on white and at least 5.3:1 on every layer |
| `--kr-attention` / `-text` | `#D97706` / `#9A4A08` | text 6.3:1 on white and at least 5.1:1 on every layer |
| `--kr-danger` / `-text` | `#DC2626` / `#B91C1C` | text 6.5:1 |
| `--kr-scrim` | `rgba(15,17,19,0.45)` | |

## Typography

- **Families:** IBM Plex Sans for prose and controls, IBM Plex Mono for data.
- Inter is not an option.
- An all-mono UI was rejected: Kick Rocks shows long broker emails, legal bases and forms.
- **Bundling:** vendor the `.woff2` files into `apps/web/src/fonts/` with `OFL.txt`, declare them with `@font-face` in `index.css`, and let Vite fingerprint them.
  This adds no runtime dependency and passes the server's `default-src 'self'` CSP with no change.
  No Google Fonts, no CDN, no `@fontsource` runtime import from a third-party host.
- **Files:** Plex Sans 400, 500, 600 (plus 400 italic for quoted mail) and Plex Mono 400, 500, 600, latin and latin-ext subsets, `font-display: swap`, with metric-matched local fallback faces and and a build-time preload of the Latin 400, 500 and 600 Sans files and the 600 Mono logo face.
- **Weights:** 400 body, 500 labels and nav, 600 titles and emphasis; never 700.
- **Mono does real work**: request references, domains, email addresses, timestamps and dates in tables and timelines, all counts and numbers, section labels, column headers, keycaps, the version string, the wordmark, units ("of 150", "45 d").
- All numbers use `font-variant-numeric: tabular-nums`.

**Scale.**

| Token | Size / line | Family, weight, tracking | Use |
|---|---|---|---|
| `label` | 11 / 14 | Mono 500, +0.07em, uppercase | section labels, column headers, tags |
| `caption` | 12 / 16 | Sans 400 | timestamps under text, footnotes |
| `meta` | 13 / 18 | Sans 400 or Mono 400 | secondary row text, domains, help text |
| `ui` | 14 / 20 | Sans 400/500 | default UI text, table cells, buttons, nav |
| `body` | 15 / 22 | Sans 400 | reading text: email bodies, explanations |
| `heading` | 18 / 24 | Sans 600 | dialog titles, detail page section titles |
| `title` | 22 / 28 | Sans 600, -0.01em | page title |
| `numeral` | 28 / 32 | Mono 500, tabular | the few big counts on the dashboard |

- Phone keeps the same scale; the title drops to 20 and inputs stay 16px to stop iOS zoom.
- Nothing below 11px, and 11px only for uppercase labels.

## Spacing, radius, borders, elevation

- **Spacing scale:** 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 48.
  14 is a real step, and 10/6/14 are the named rhythm insets.
- **Gutter:** 20px desktop, 16px phone.
- **Control heights:** 28 small, 34 default, 40 large on desktop; 44 on phone and on any coarse-pointer device.
- **Row heights:** 36 for table and list rows on desktop, 44 on phone and on any coarse-pointer device; two-line rows 52 maximum.
- **Bars:** header bar 48, phone top bar 52.
- **Radius scale:** `xs 4` (tags, keycaps, checkbox), `sm 6` (buttons, inputs, selects, tabs), `md 10` (row groups, tables, callouts), `lg 12` (dialogs, popovers, the login panel), `full` (toggles, meters, avatars, status dots only).
  Nothing is rounder than 12.
- **Borders:** 1px `--kr-line` separates everything; row dividers are 1px inside a group, never a gap plus a border.
- **Elevation:** tone first, border second, shadow only for floating layers.
  Popovers and menus: `0 16px 40px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4)` dark, `0 12px 32px rgba(15,17,19,.14), 0 1px 3px rgba(15,17,19,.08)` light.
  Dialogs: `0 18px 50px rgba(0,0,0,.5)` dark, `0 20px 48px rgba(15,17,19,.18)` light.
  Sticky bars (campaign send bar, table header) get a hairline, not a shadow.
- **Focus vs selection:** focus is a 2px `--kr-focus` outline with 2px offset; selection is `accent-soft` fill plus a 3px left marker.
  They must never look alike.

## Density

- Compact by default: 14px UI text, 36px rows, 34px controls on desktop.
- Targets and Requests show 50 rows per page.
- Settings are rows with values on the right, not stacked forms.
- No per-field help text unless the field is genuinely ambiguous.

## Layout and navigation

- **Rail** (`--kr-rail`, 216px, 1px right border): 22px mark plus mono wordmark at the top, profile switcher, then two nav groups (work: Dashboard, Review, Requests, Targets; setup: Profiles, Settings), with About and the mono version pinned at the bottom.
- Put Review second, because it is where the person acts.
- **Nav rows:** 32px, 14px Sans 500, 16px icons at 1.5 stroke in `ink-3`.
  Active is `accent-soft` fill, `accent-text` label and icon, and a 3px by 18px `accent-fill` tab on the left edge with `0 3px 3px 0` radius.
- Review count is a right-aligned mono tabular number in `attention-text`, no pill.
- **Header bar** (48px, `--kr-rail`, 1px bottom border) across the content area.
  Left: breadcrumb in 13px (`Requests / Fixture Verify Data`), with the reference in mono.
  Right: up to three status chips, each a pill with a 1px border, a 6px dot with a 3px halo, and 12px text: `Worker online`, `Inbox 7m ago`, `Sent 1/150 today`.
  A `MOCK` mono tag sits here in mock mode.
- **Content** is left-aligned with the 20px gutter.
  Tables and the review queue use the full width.
  Forms, detail summaries and settings cap at 720px and stay left; the empty right side is accepted.
- **Page header:** a 22px title with a muted 13px subtitle on the same baseline, then the page actions on the right, then a hairline.
  Subtitles are 8 words or fewer, or absent.
- **Sections:** an 11px mono uppercase label with the count folded in (`NEEDS YOU · 11`, `SCHEDULE`, `WORKER · ONLINE`), then one bordered group of rows.
  No section ever has a title plus a description inside a card.
- **Phone (under 640px):** 52px top bar with menu, mark and the most urgent status dot; the rail becomes a drawer; lists drill down to a detail page with back.
  Layout follows width, never platform.

## Signature components

**Status mark**.
- A 10px shape plus a plain word, with no pill background and no lucide icon.
- Shapes and families, matching the dashboard groups:
  - In progress, waiting on someone else: hollow ring in `ink-3` (Draft uses a dashed ring, Queued a ring, Sent and Awaiting reply a ring in `ink-2` with a centre dot).
  - Resolved: filled disc in `positive` (Confirmed, No record); Cancelled is a short dash in `ink-3`.
  - Needs you: filled triangle in `attention` (Needs verification, Follow-up due, No response).
  - Failed: filled square in `danger` (Rejected, Bounced, task Failed).
  - Running: ring with a 1.2s rotating gap, frozen under reduced motion.
- The word is 13px Sans in `ink-2`; only the Needs you and Failed words take their tone color.
- Description goes in the custom tooltip, not `title`.

**Tag**.
- 11px mono uppercase, +0.06em, 1px `--kr-line` border, `xs` radius, `ink-2` text, 18px tall.
- No tinted backgrounds; the only toned tag is `attention` outline for requirements that need the person (CAPTCHA, phone call, paid, account).
- Where a fact is just text ("Email or web form", "None"), print text, not a tag.
  Empty cells get a muted `-`, never the word "None".

**Ledger table** (`Table.tsx`, used by Targets, Requests, Profiles, Scans).
- Header row: 32px, 11px mono uppercase `ink-3` labels, 1px bottom border, sticky.
- Body rows: 36px single line; the identifier column may add a second line in 12px mono `ink-3` (domain or reference) for a 52px row.
- Numbers and dates right-aligned, tabular mono.
- Hover is a `--kr-hover` fill; selected rows get `accent-soft` plus the 3px marker; row actions (open, delete, retry) appear on hover or focus.
- Toolbar above the table on one line: search field (280px), then compact filter selects that show their value ("Type: all"), then a right-aligned mono count (`932 targets`).
- Pagination: `1-50 of 932` in mono, previous and next as 28px icon buttons.
- Targets columns: Target (name 14/500 plus mono domain), Category, Priority, Contact, Needs, Scan, Removal.
  Priority is a mono word in `ink-2` with crucial in `ink` 600, or a three-step bar glyph, never a tinted pill.
  Scan and Removal are two status marks, not four tags.
- Requests columns: Target (name plus mono reference), Status (mark), Asked (`opt-out`, `delete` as mono tokens joined by a middle dot), Channel, Sent, Due.

**Review queue**.
- Split pane on desktop (at 1024px and up): a 360px list on the left grouped under mono section labels by kind (`BLOCKED · 3`, `RECORDS · 3`, `DETAILS ASKED · 2`, `UNSORTED MAIL · 2`, `FAILED · 1`), and the selected item on the right.
- The left list's group labels stand in for tabs, so every waiting item is visible in one place.
- List rows: 44px, title (target or sender) in 14/500, one line of reason in 13px `ink-3`, mono age on the right, status shape on the left.
- Detail pane: the facts as a compact definition list, the message body in 15px reading text with a 2px left rule for quoted mail, and the decision controls in a footer bar pinned to the bottom of the pane.
- Keyboard: `j` and `k` move, `Enter` opens, `1` to `4` pick a classification, shown as mono keycaps in the footer.
- One filled primary per item; the alternative ("Send nothing and cancel") is a secondary button; the disabled primary is `--kr-active` fill with `ink-3` text, not a washed accent.
- Phone: the list is the page and an item drills down to the detail with back.
- After a decision the next item is selected automatically, with a toast only for confirmation ("Sent date of birth to ClearCheck").

**Campaign builder**.
- Two columns on desktop: choices on the left (max 480px), the live preview on the right, so the half of the screen that would be empty shows the result.
- Choices are row groups: `WHO` as four selectable rows with a radio, a 14px name and a 13px count in mono on the right (`412 targets`), and `ASK FOR` as two checkbox rows.
  Per-option descriptions shrink to one short clause or move into the tooltip.
- The preview is a console readout: mono counts by channel (`email 312`, `web form 88`, `scan first 12`), a list of the first targets, and warnings as attention text.
  It is visible from the start with zeros, rather than hidden behind a sentence.
- The send bar is a sticky footer with a 1px top border, a mono summary on the left (`400 requests · opt-out, delete`) and the single primary on the right; no shadow.
- The confirm dialog repeats the count and the law in mono.

**Timeline**.
- A left gutter with the mono time (`09:02`, then `Oct 6` for older days), the status shape on a 1px vertical rule, and one line of text.
- Consecutive events within a minute group under one time.
- Status changes fold into the event that caused them ("Sent the email", not a separate "Status changed from Queued to Sent").
- The actor shows only when it is the person ("you approved sending date of birth"); system events need no "by Kick Rocks".
- Only Needs you and Failed events take color; everything else is `ink-3` shapes.
- An error appears once, on the event that failed, in `danger-text`, with Retry beside it.

**Meter**.
- A 6px pill track in `--kr-active` with an `accent-fill` bar, mono readout on the right (`1 of 150`), and tick marks at 50% and 80%.
- Used for the daily send quota, scan progress and reply-due windows (`due in 12 d` with the bar showing elapsed time, turning `attention` past 80%).
- Fill transitions 120ms linear; no gradient except the calibrated green-amber-red one if a zoned meter is ever needed.

**Row group**.
- A 1px bordered `md`-radius box of rows divided by hairlines.
- Each row: optional 32px rounded-square icon tile (`--kr-active` fill, 16px `ink-2` glyph), a 14px title, a 13px `ink-3` description of at most one line, and a trailing control or value.
- Settings, About, Profile detail, Mailbox and the dashboard's Needs you list all use it.
- `Card` stays only for genuinely bounded objects (a dialog body, the login panel).

**Forms and fields**.
- Label 12px Sans 500 `ink-2` above the control, 6px gap.
- Control: 34px, `--kr-field` fill (inset in dark), 1px `line-strong` edge, `sm` radius, 14px text; mono variant for emails, URLs, model names and numbers.
- Focus: the edge turns `accent-fill` and the 2px outline appears.
- Error: edge `danger`, 12px `danger-text` message under the field with no icon; errors land on the failing field.
- Help text only where a field is ambiguous, 12px `ink-3`, one clause, never stating a default.
- Settings forms are rows: label on the left, control on the right (180px for numbers with a mono unit suffix: `45 d`, `1 min`), saved per section with one button at the section's end.

**Buttons**.
- Primary: `accent-fill`, `accent-on`, 14px Sans 600, `sm` radius, one per screen.
- Secondary: transparent, 1px `line-strong` edge, `ink` text.
- Ghost: `ink-2` text, hover fill only.
- Danger: outlined in `danger` with `danger-text`, never filled; the confirm dialog's final button may fill.
- Disabled: `--kr-active` fill, `ink-3` text, no opacity trick.
- Press: 100ms, `scale(0.98)`.
- Icons inside buttons only when the icon disambiguates (external link, copy); "New campaign" and "New profile" are words.

**Tabs**.
- 14px Sans 500 `ink-3`, active `ink` with a 2px `accent-fill` underline; counts as mono `· 3` in the same color, never a tinted chip.

**Callout**.
- 1px tone border (`attention` or `danger`) on `--kr-surface`, `md` radius, 13px text, one line where possible, inline action on the right.
- No filled tinted backgrounds.

**Tooltip**.
- `--kr-popover` with `line-popover` edge, `xs` radius, 12px text, 600ms delay, no arrow.

**Keycap**.
- 11px mono keycaps with a 1px border, used for the review queue shortcuts.

**Skeleton**.
- `--kr-active` blocks shaped like the real rows, opacity pulse 0.35 to 0.7 over 900ms, no shimmer.

**Placeholder hatching**.
- Missing screenshots in Review (blocked tasks) and missing target logos use a 45-degree hatch of `ink-3` at 8% instead of a grey block.

## Icons

- Keep `lucide-react` , but set `strokeWidth={1.5}` everywhere through one wrapper.
- Sizes: 16 in rows, buttons and nav; 20 in the header bar and empty states; 14 only inline in text.
- Color: `ink-3` by default, `ink-2` on hover, `accent-text` only for the active nav item (5/5 projects use muted icons).
- Remove icons from status (shapes replace them), from primary buttons, and from section labels.
- Icons that stay: nav, row-leading tiles in row groups, toolbar actions, external-link and copy affordances.
- The logo mark is a 22px rounded-square tile (`xs` 5px radius) in `accent-fill` with the pebble in `accent-on`, beside a mono 14px/600 `Kick Rocks` wordmark with +0.02em tracking.

## Motion

| Token | Duration | Curve | Use |
|---|---|---|---|
| `--kr-fast` | 100ms | ease-out | hover fill, press, color changes |
| `--kr-base` | 160ms | cubic-bezier(.33,1,.68,1) | selection marker, nav tab, drawer, tab underline |
| `--kr-slow` | 240ms in, 160ms out | ease-out-cubic in, ease-in out | dialogs, popovers, toasts |
| `--kr-pulse` | 900ms alternate | ease-in-out | skeleton only |

- The selection marker grows from its center on `--kr-base` while the hover fill runs on `--kr-fast`.
- New review items and toasts enter with a 6px rise and fade on `--kr-slow`; nothing else animates on mount.
- No bounce, spring, parallax, page transitions or shimmer.
- Theme switching is instant.
- A global reduced-motion block stops every animation.

## Empty and error states

- Empty: one sentence in 14px `ink-2`, left-aligned at the top of where the content would be, plus at most one text link or secondary button.
  No centered icon, no card, no title plus description.
  Examples: `Nothing needs you.`, `No requests yet.
  Start a campaign.`, `No targets match these filters.`
- Loading: skeleton rows shaped like the content, never a centered spinner for a list.
- Errors attach to what failed: a field error under the field, a task error on the task row and timeline event, a failed page load as one line with Retry where the content would be.
- Transient trouble (inbox unreachable, worker offline) is `attention`; a failure that needs action is `danger`, outlined.
- Toasts are only for confirming something the person just did; errors never toast.
- Route errors and 404s show a plain sentence and a link home, never a raw exception string.

## Copy

- Sentence case everywhere, including buttons and tabs .
- Page subtitles 8 words or fewer, or none: `Dashboard  where requests stand`, `Requests  every request for Jordan`, `Targets  932 brokers and companies`.
- Section labels name the thing and carry the count: `NEEDS YOU · 11`, `IN PROGRESS · 13`, `PRIVACY LAWS · 31 STATES`.
- Settings rows: label at most 5 words, description at most one sentence of 12 words, never state a default, never explain the implementation.
  `Check inbox every` with value `1 min`; `Wait for a reply` with `45 d`; `Follow-ups` with `2`.
- One word per thing: choose `target` for brokers and companies in UI chrome, `request` for a sent ask, `record` for a scan match, `profile` for a person; do not mix `site`, `listing`, `broker` and `company` in labels.
- Status text is a plain state: `Worker online`, `Inbox checked 7m ago`, `Sent 1 of 150 today`.
- Relative times are short (`7m ago`, `2h`, `yesterday`, `next month`) and exact times live in the tooltip.
- Remove self-reference where it adds nothing: a review item shows its reason line without a banner saying Kick Rocks is unsure, and timeline events do not say "by Kick Rocks".
- No exclamation marks, no em dashes, no "Learn more" without a real destination.

---
