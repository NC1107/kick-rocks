# Kick Rocks design language

Evidence comes from five of Nick's own UIs (sink, slim-m, echo-messenger, check-in, npc-shelf) and from screenshots of the Kick Rocks UI before the redesign.
npc-shelf is close to stock shadcn, so it only counts as evidence for what he leaves alone, never for taste on its own.
Strength labels: **Strong** means 4 or 5 projects, **Medium** means 2 or 3, and **Single** means one project, usually sink or slim, where the choice was clearly deliberate.

The short version: Kick Rocks today has tidy tokens and honest copy, but structurally it is a generic SaaS admin.
Every section sits in a rounded card with a title and a sentence under it, every fact is a tinted pill, the accent is a pastel default blue, the type is the system sans, and the content floats in a centered column.
Nick's own apps read as instruments: near-black tonal layers, one rationed accent, monospace for every number and identifier, tracked uppercase section labels, rows instead of cards, and very little chrome.

---

## 1.
Nick's design language

### 1.1 Recurring choices

| # | Choice | Seen in | Strength |
|---|---|---|---|
| 1 | Dark-first, near-black neutrals with a faint cool tint, layered in small tonal steps (`#0A0A0B` to `#0F0F10` to `#141415` to `#1C1C1E` to `#232326` to `#27272A`) | sink, echo (identical hexes), slim (`#0F1113`/`#17191C`/`#1F2226`), check-in (`#0A0A0A`/`#161616`/`#1F1F1F`), npc-shelf (`class="dark"` default) | Strong (5/5) |
| 2 | Exactly one saturated accent, rationed to actions and selection; color otherwise only means state | sink indigo, echo indigo, slim cyan (closed list of seven roles, "anywhere else is a bug"), check-in green, npc-shelf none at all | Strong (5/5) |
| 3 | Borders and tonal steps carry depth; shadows only on things that float (menus, dialogs, toasts) | sink, slim ("the strongest decision in the system"), echo ("borders before shadow"), check-in (one BoxShadow in the app), npc-shelf | Strong (5/5) |
| 4 | No decorative gradients, glass, blur, illustration, mascots or emoji in chrome | all five; echo anti-goals: "Premium != decoration" | Strong (5/5) |
| 5 | Outlined line icons at 16 to 21px in muted ink, rarely accent-colored | sink (Material Symbols Outlined), slim (Lucide 300 at 1.5px), echo (Material outlined, 238 vs 31 rounded), check-in (outlined idle, filled active), npc-shelf (Lucide 16px) | Strong (5/5) |
| 6 | Plain, literal, short copy; no exclamation marks, no marketing, plain hyphens | all five; slim enforces it with a wording test gate | Strong (5/5) |
| 7 | Motion is short and functional (60 to 280ms), never bouncy, and reduced-motion is honored | sink 0.06-0.24s, slim 100/180/280ms, echo 80-300ms with a ban on bounce, check-in 200-220ms, npc-shelf transitions only | Strong (5/5) |
| 8 | Radii stay moderate: controls 6 to 10, panels 10 to 14, full pills only for small controls (toggles, chips, avatars, meters) | sink 6/10/12, slim 6/10/16, echo 6/8/10/12 (14 max), check-in 10/12/14, npc-shelf 6/8/12 | Strong (5/5) |
| 9 | Monospace for technical identifiers, numbers and hints | sink (mono is the whole UI), slim (timestamps, channel names, wordmark, keycaps, hints), echo (handles, fingerprints, version), npc-shelf (Ctrl+K hint) | Strong (4/5) |
| 10 | Small uppercase tracked section labels with the count folded in ("MUSIC · 1", "ONLINE · 5", "ACCOUNT PREFERENCES") | sink, slim, echo, npc-shelf (check-in uses caps only in pill badges) | Strong (4/5) |
| 11 | Dense, compact chrome: 48 to 56px bars, 30 to 44px rows, 13 to 15px text | sink, slim, echo, npc-shelf (check-in is a roomier phone app) | Strong (4/5) |
| 12 | Persistent left navigation with a tinted active item; settings and version pinned at the bottom | sink, slim, echo, npc-shelf | Strong (4/5) |
| 13 | One token file is the law, with contrast ratios argued in comments | sink, slim (tested gates), echo, check-in | Strong (4/5) |
| 14 | Empty states are one plain sentence, usually with no illustration and at most one action | sink, slim, check-in, npc-shelf (echo adds an icon and a CTA) | Strong (4/5) |
| 15 | Text sizes cluster at 11 (labels), 12 to 13 (meta), 14 (UI) and 15 (reading text) | slim, echo, sink, check-in | Strong (4/5) |
| 16 | Light mode exists but dark is the reference | slim (light, dark, true black), echo (Paper), npc-shelf; sink and check-in are dark only | Medium (3/5 offer light) |
| 17 | Keyboard shortcuts shown inline as mono keycaps | slim (Ctrl + K chip, "shift + enter for newline"), echo (Ctrl+/), npc-shelf (Ctrl+K palette) | Medium (3/5) |
| 18 | Several named themes over one fixed role set | sink (Original, Tokyo Night, Gruvbox), echo (six), check-in (accent presets) | Medium (3/5) |
| 19 | A self-hosted, deliberate typeface instead of the system stack, never Inter | sink (Fira Code), slim (IBM Plex Sans and Mono, Inter rejected as "default choice of every SaaS dashboard"); echo uses Inter, check-in and npc-shelf use the system font | Medium (2/5) |
| 20 | Active nav marked by a fill plus a 3px accent tab on the left edge | sink, slim (npc-shelf explicitly has none) | Medium (2/5) |
| 21 | Content left-aligned at a readable cap, empty space on wide screens accepted | sink (~630px pages), slim (760px message cap); echo centers settings at ~850px | Medium (2/5) |
| 22 | A second hue only to separate two kinds of object, never for actions | sink (amber mixes vs indigo channels), check-in (group colors "never an action color") | Medium (2/5) |
| 23 | Secondary actions revealed on row hover or focus | sink (strip corner buttons), slim (kebab on hover) | Medium (2/5) |
| 24 | Bright accents take near-black text; dark accents take white | echo, check-in (`#07140C` on green), slim (`#070E12` on cyan) | Medium (3/5) |
| 25 | State is carried by shape and words, not color alone | slim (disc, ring, dash, triangle), echo (style rule "no colour-only status"), check-in (filled vs outlined icons) | Medium (3/5) |
| 26 | Weight capped at 600 | slim (no 700 bundled), echo ("prefer 600"); check-in uses 700 heavily | Medium (2/5) |
| 27 | Hardware or instrument metaphor where it earns its keep (fader caps, calibrated VU meter, banks of strips) | sink | Single |
| 28 | Danger buttons outlined, errors attached to the failing thing and never toasted | slim; echo limits red to destructive actions | Single (partial in echo) |
| 29 | Hatching for missing imagery instead of a flat grey block | slim | Single |
| 30 | Custom tooltip instead of the native `title` popup | sink (1200ms), echo (500ms themed tooltip) | Medium (2/5) |
| 31 | Popovers lighter than the surface below with a stronger border, so they have an edge | sink, slim (raised is the lightest surface) | Medium (2/5) |

### 1.2 What he avoids, in his own words

- "More glow / gradients / glassmorphism.
  Premium != decoration." (echo `docs/ux-roadmap.md` anti-goals).
- "Cartoon motion.
  No Curves.bounceOut, no elastic" (echo).
- Inter as "default choice of every SaaS dashboard" and Material Icons as "unstyled default Flutter" (slim 0004 review).
- A purple theme, which he replaced with green on black (check-in README).
- An accent border anywhere outside the seven accent roles, which slim calls a bug.
- Filled red danger buttons, error toasts, nested modals, a dropdown for two or three options, and a tooltip as the only carrier of information (slim).
- Settings copy that states a default, explains the implementation, or adds an invented "Learn more" (slim wording gate).
- Pure `#000` or `#FFF` text on dark, large card shadows, and stretching content to fill a wide window (sink).

### 1.3 How he works

- He fixes visual problems by measuring, not by adding decoration: slim moved teal to cyan after simulating deuteranopia on a render, and sink lightened the popover layer when it had no edge.
- He writes the reasoning down next to the token, with contrast ratios, and records what was rejected.
- He builds components from scratch rather than pulling a kit (sink CLAUDE.md, check-in's dependency-free skeleton).
- So the Kick Rocks target should be argued token by token, and verified against renders side by side.

---

## 2.
Where the current Kick Rocks UI diverges

### 2.1 What is already right

- Tokens live in one file (`apps/web/src/index.css`) with intent comments, Tailwind's palette is removed, and shadows are limited to `pop` and `dialog`.
- Reduced motion is honored and there is only one deliberate animation.
- Status never relies on color alone, since each status has a word and an icon.
- Copy is plain, uses no exclamation marks, and avoids marketing.
- Focus is a 2px outline, the phone layout swaps to a drawer, and controls grow to 44px on phones.
- Keep all of this.
  The problem is structure and voice, not hygiene.

### 2.2 The generic AI tells, named precisely

1. **Card-everything layout.**
   39 page files render 62 `<Card>` elements, and nearly every section is a `rounded-lg border bg-surface p-5` box with a 16px title and a muted sentence under it (`CardHeader`).
   Dashboard, Settings, About, Request detail and every Review item are stacks of these.
   Nick groups rows under a tracked section label and puts only the rows in a box (sink Apps, echo Settings, slim settings panes).
2. **Pill badges for everything.**
   `Badge` appears 101 times and `StatusPill`/`TaskStatusPill` 17 times.
   The dashboard alone shows 12 tinted status pills, Targets shows a tinted pill per priority, one per requirement, and four "Not checked" chips per row.
   Nick has one badge idiom per app and uses it sparingly (slim role badges, check-in `PillBadge`).
3. **Default blue accent.**
   Dark accent is `oklch(0.74 0.12 255)`, about `#75AEF5`, a pastel sky blue with dark text, and light accent is about `#145EC1`.
   That pairing is the stock Tailwind or Radix blue look.
   Disabled primaries become a washed-out blue slab (Review "Classify", "Send selected details"; Campaign "Send requests").
4. **Eleven-hue tone system.**
   `lib/tone.ts` defines neutral, slate, blue, indigo, violet, teal, green, amber, orange, red and sand.
   Request statuses alone use nine of them, so the dashboard is a rainbow.
   Nick uses three or four semantic hues plus one accent.
5. **System font stack.**
   `--font-sans` is `ui-sans-serif, system-ui`, which renders as Noto Sans on Fedora and as something else elsewhere.
   There is no bundled face and no typographic voice; mono is only used for `KR-` references.
6. **Centered content column.**
   `AppLayout` wraps every page in `mx-auto max-w-6xl`, so on wide screens the page floats in the middle with gutters on both sides.
   Nick left-aligns content and lets the right side stay empty (sink Apps, slim transcript).
7. **Lucide icons everywhere at default weight.**
   47 files import from `lucide-react`, at stroke 1.75 to 2.
   Icons lead every nav item, every status pill, every primary button ("New campaign" paper plane, "New profile" plus), and every review count.
   Nick's icons are thinner (1.5px), muted, and absent wherever a word is enough.
8. **Verbose helper text.**
   Every page has a full-sentence subtitle, every card has a description, and most fields have a help line ("How often Kick Rocks looks for replies.").
   Review mail cards add an amber "Kick Rocks is unsure what this is" pill on top of a muted reason line that already says so.
   The request timeline repeats "by Kick Rocks" on 14 of 17 events and repeats the same error in four places.
9. **Generic stat-card dashboard.**
   Three big numbers with colored underline bars, each over a list of pills, plus a "Needs you" list with amber count circles.
   This is the default analytics-dashboard template.
10. **Uniform rounded boxes and tall rows.**
    Tables use 70 to 85px rows with three stacked lines (Targets, Requests), so 25 of 932 targets fill a 2,400px page.
    Nick's tables and lists run at 30 to 44px per row.
11. **Generic wordmark.**
    "Kick Rocks" is 20px bold system sans next to a 28px blue tile.
    Nick's wordmarks are small and deliberate (sink 14px/600 with 0.3px tracking, slim mono medium with +0.04em).
12. **Native `title` tooltips.**
    30 `title={...}` uses, including every status description.
    Sink replaced these with a custom tooltip on purpose.

### 2.3 Screen by screen

**Shell and navigation** (`components/layout/AppLayout.tsx`, `Sidebar.tsx`, `Logo.tsx`).
- 240px sidebar on `#0A0C10` against a `#0E1114` canvas, which is close to Nick's tonal stepping and can stay.
- Active item is a soft-blue filled block with blue text and no left marker; Nick's apps add the 3px tab (sink, slim).
- Review count is a solid blue pill; in Nick's apps counts are plain tabular numbers or a 6px dot.
- No header bar, so live system state (worker online, inbox last checked, sending quota) is buried in dashboard cards and Settings.
  Sink puts "Engine running" in the header, slim puts presence in the rail footer.
- "Mock data" is an amber pill in the sidebar footer; it belongs in a header tag.
- Full-page screenshots show the sidebar stopping at 900px on long pages.
  That is the fixed rail in a full-page capture, not a product bug, but verify at real scroll positions.

**Dashboard** (`pages/dashboard/index.tsx`, `sections.tsx`).
- Three generic stat cards with colored underline bars and 12 tinted pills is the most "template" screen in the app.
- "Needs you" is the real job of the page but sits in a side card on desktop and second on phone.
- Count circles in amber for every row mean amber stops meaning anything.
- Recent activity repeats the "Status changed from Draft to Queued." pattern; it reads as a log dump.
- Phone: 32px title, a full-width 88px pastel button, and 18px row text make the page feel like a marketing landing.

**Targets** (`pages/targets/index.tsx`, `RequirementBadges.tsx`, `Automation.tsx`).
- Rows are three lines (name, domain, category), about 70px tall at 1280px.
- Priority is a tinted pill ("Crucial" in pink, "High" in indigo, "Normal" in grey), which adds two more hues.
- Requirements are amber and grey pills; "None" is printed in every empty cell.
- Automation is four labels per row ("Scan / Removal" each with "Not checked"), which is the noisiest column.
- Five equal-width dropdown filters span the full width under a search box; it reads as a form, not a toolbar.

**Requests** (`pages/requests/index.tsx`).
- Three-line rows again; "Opt out of sale, Delete my data" is repeated, wrapped, in every row.
- Status pills carry both icon and tint; in a list of 15, ten are the same indigo "Awaiting reply" pill.
- "next month" in the Reply due column is good copy; keep relative dates.

**Request detail** (`pages/requests/detail/index.tsx`, `Timeline.tsx`).
- A filled red banner, then a Summary card, Timeline card, Replies card and Tasks card, stacked.
- The error string appears four times (banner, two timeline events, task row).
- The timeline uses six dot colors, puts the time and actor under each line, and says "by Kick Rocks" on almost every event.
- Summary is a decent definition list but sits in a card with a heading that adds nothing.

**Review** (`pages/review/*`).
- Seven tabs with tinted count chips (amber, red), then one large card per item with a full form inside.
- Unclassified mail: each message is a card with a title, a pill, a muted reason, a body excerpt, an outlined "Read the whole message" button, a divider and a two-select form.
  With 20 items this is a very long scroll with no way to move item to item.
- Verifications: every card repeats "They asked for" and "Tick only what you are willing to send.
  Anything you leave unticked stays private." and a disabled pastel primary.
- Scans is the best-looking tab already: a real table with short rows.

**New campaign** (`pages/campaigns/new/index.tsx`, `PreviewPanel.tsx`).
- Two cards of radio and checkbox options with a description under every option, then a floating footer card with a drop shadow.
- The shadowed footer breaks the "only floating layers get shadows" rule he applies everywhere.
- The preview (the most important part: what will happen) is hidden until a choice is made, and the right half of the screen is empty.

**Settings** (`pages/settings/*`).
- A 4,200px page of stacked cards: Schedule form, Worker, Language model, 51 collapsible state rows, Password.
- Every field has a label and a help line; the schedule form alone has 10 lines of help text.
- The privacy-laws list is a 51-row accordion where most rows say "0 laws".
- Nick's pattern is a settings index with grouped rows and values on the right (echo, slim SettingsPanes).

**Profiles** (`pages/profiles/index.tsx`).
- A single-row table in a rounded box, a blue "Current" pill and a green "Connected" pill, and a trash icon always visible.
- The trash action should be hover or focus revealed (sink, slim) and confirmed.

**Mailbox wizard** (`pages/mailbox/steps.tsx`).
- The numbered stepper with check circles and hairlines is fine and close to Nick's restraint.
- The filled light-blue info box is a generic callout; Nick's callouts are a 1px tone border on the surface.

**About** (`pages/about/index.tsx`).
- Three cards; the license chips on the right are outlined, which is already the quieter idiom.
- Version, counts and license names should be mono.

**Login and setup** (`pages/login`, `pages/setup`).
- A centered card on a black page with a pastel full-width button.
- Acceptable structure for an auth screen, but it shares the default-blue and system-font problems.

---

## 3.
Target for Kick Rocks

The direction in one line: **a quiet instrument panel for one person's privacy**, using sink's tonal dark and mono discipline, slim's documented token rules, echo's role set, and check-in's single-accent rationing.

### 3.1 Color

Rules.
- Dark is the reference theme and the default when the OS gives no preference (Strong, 5/5).
- Light ships too, because the app already supports it and slim, echo and npc-shelf all offer one (Medium).
- One accent, split into four roles like slim: `accent-fill` (primary button, selected tab underline, active nav tab), `accent-on` (text on the fill), `accent-text` (links and accent glyphs), `accent-soft` (active nav and selection wash).
- Accent is allowed in exactly these places: primary button, links, active nav item, selected tab, focus ring, row selection, checkbox and radio fill, meter fill.
  Anything else using accent is a bug (slim's rule).
- State uses four semantic families only: positive, attention, danger, and neutral.
  No other hues exist.
- Text is never pure white on dark.
- Hex values are the source of truth, with an `-rgb` triplet for each semantic color so washes and halos can take their own alpha (sink).

**Accent choice.**
Default: Nick's own indigo `#5557E0`, used with identical hexes in sink and echo, which is the strongest single color signal across his work.
It avoids the AI look only if it is rationed, never used in a gradient, never tints surfaces, and stays this darkened hex rather than Tailwind's `#6366F1`.
Fallback: slim's glacier cyan, if a side-by-side render (see 4.5) shows the indigo reads as generic.
Both are listed below so the swap is five values.

**Dark tokens.**

| Token | Hex | Use | Evidence |
|---|---|---|---|
| `--kr-frame` | `#0A0A0B` | page behind everything, phone top bar | sink `--bg-main`, echo `mainBg` |
| `--kr-rail` | `#0F0F10` | sidebar, header bar | sink `--bg-sidebar`, echo `sidebarBg` |
| `--kr-canvas` | `#141415` | content area | echo `chatBg` |
| `--kr-surface` | `#1C1C1E` | row groups, tables, panels | sink and echo `surface` |
| `--kr-hover` | `#232326` | row and control hover | sink and echo `surfaceHover` |
| `--kr-active` | `#27272A` | pressed, toggle off, meter track | sink `--bg-active` |
| `--kr-field` | `#0F0F10` | inputs and selects, darker than the surface so they read as inset | sink `.select` on `--bg-main` |
| `--kr-popover` | `#2B2B31` | menus, popovers, tooltips | sink `--bg-popover` |
| `--kr-popover-hover` | `#38383F` | menu item hover | sink |
| `--kr-line` | `#27272A` | hairlines, row dividers | sink and echo `border` |
| `--kr-line-popover` | `#45454E` | popover and dialog edge | sink `--border-popover` |
| `--kr-line-strong` | `#6B6B75` | control edges, 3.2:1 on surface | slim `borderStrong` rule (3:1) |
| `--kr-ink` | `#EDEDEF` | primary text | sink and echo |
| `--kr-ink-2` | `#ABABB0` | secondary text, 7.4:1 on surface | sink and echo |
| `--kr-ink-3` | `#8A8A96` | muted text, labels, 5.0:1 on surface and 4.6:1 on hover | sink and echo `#848490`, lifted one step because that value is 4.2:1 on the hover fill |
| `--kr-accent-fill` | `#5557E0` | primary fill, white text at 5.5:1 | sink and echo `accent` |
| `--kr-accent-fill-hover` | `#6466E8` | primary hover | derived, small lift |
| `--kr-accent-on` | `#FFFFFF` | text on the fill | echo (dark accent takes white) |
| `--kr-accent-text` | `#818CF8` | links, active nav label and icon, 5.7:1 on surface | sink `--accent-hover` used for active nav |
| `--kr-accent-soft` | `#1C1C2D` | active nav and selection wash (accent at 12% on canvas) | sink `--accent-light`, slim `accentSoft` |
| `--kr-focus` | `#818CF8` | 2px focus outline | slim focus ring in accent |
| `--kr-positive` | `#22C55E` | dot and shape fill | sink `--online`, echo `online` |
| `--kr-positive-text` | `#4ADE80` | positive text, 9.8:1 | derived |
| `--kr-attention` | `#F59E0B` | dot and shape fill | sink `--warning`, echo |
| `--kr-attention-text` | `#FBBF24` | attention text, 10.2:1 | derived |
| `--kr-danger` | `#EF4444` | dot, outlined danger button edge | sink `--danger`, echo |
| `--kr-danger-text` | `#F87171` | danger text, 6.2:1 | derived |
| `--kr-danger-wash-text` | `#FCA5A5` | text on a danger wash | sink `--on-danger-wash` |
| `--kr-scrim` | `rgba(0,0,0,0.55)` | dialog backdrop | sink |

**Light tokens** (cool slate, from slim's tested light ramp, with muted text lifted for AA the way check-in did).

| Token | Hex | Note |
|---|---|---|
| `--kr-frame` | `#EFF1F3` | slim `sunken` |
| `--kr-rail` | `#EFF1F3` | slim rails are sunken |
| `--kr-canvas` | `#F7F8F9` | slim `base` |
| `--kr-surface` | `#FFFFFF` | slim `raised` |
| `--kr-hover` | `#F0F2F4` | one step down from surface |
| `--kr-active` | `#E6E9ED` | pressed, meter track |
| `--kr-field` | `#FFFFFF` | with `line-strong` edge |
| `--kr-popover` | `#FFFFFF` | with `line-popover` edge and the menu shadow |
| `--kr-popover-hover` | `#F0F2F4` | |
| `--kr-line` | `#DCE0E5` | slim `borderSubtle` |
| `--kr-line-popover` | `#C9CED5` | stronger edge for floating layers |
| `--kr-line-strong` | `#858A8F` | slim `borderStrong`, 3.5:1 on white |
| `--kr-ink` | `#1B1E22` | slim, 16.7:1 |
| `--kr-ink-2` | `#5B6169` | slim, 6.3:1 |
| `--kr-ink-3` | `#666D76` | lifted from slim's `#8A929B` (3.2:1) to 5.2:1 on white and 4.6:1 on the rail |
| `--kr-accent-fill` | `#4648D4` | `#5557E0` darkened, white text at 6.7:1 |
| `--kr-accent-fill-hover` | `#3B3DC0` | |
| `--kr-accent-on` | `#FFFFFF` | |
| `--kr-accent-text` | `#4648D4` | 6.7:1 on white |
| `--kr-accent-soft` | `#ECECFC` | accent text on it at 5.7:1 |
| `--kr-focus` | `#4648D4` | |
| `--kr-positive` / `-text` | `#16A34A` / `#15803D` | text 5.0:1 |
| `--kr-attention` / `-text` | `#D97706` / `#B45309` | text 5.0:1 |
| `--kr-danger` / `-text` | `#DC2626` / `#B91C1C` | text 6.5:1 |
| `--kr-scrim` | `rgba(15,17,19,0.45)` | |

**Cyan fallback** (swap only these five).
Dark: `accent-fill #58B4D8`, `accent-on #070E12`, `accent-text #58B4D8`, `accent-soft #1D2B33`, `focus #58B4D8`.
Light: `accent-fill #1B6F91`, `accent-on #FFFFFF`, `accent-text #1B6F91`, `accent-soft #DAE9F2`, `focus #1B6F91`.
These are slim's values, chosen there after a deuteranopia simulation.

**Profile attribution color** (optional, phase 3).
When more than one profile exists, each profile gets one muted attribution hue shown only as a 3px rail on the profile switcher and a dot beside the name.
It is never used for actions or state (check-in group colors, sink's second object hue).
Use a desaturated set: `#C9826B`, `#B8A15A`, `#7FA36B`, `#5FA3A8`, `#8A8FC8`, `#B07FA8`.

### 3.2 Typography

- **Families:** IBM Plex Sans for prose and controls, IBM Plex Mono for data (slim's locked pairing; it takes sink's mono signature without forcing long legal text into mono).
- Inter is not an option (slim rejected it by name).
- An all-mono UI like sink was considered and rejected: Kick Rocks shows long broker emails, legal bases and forms, and slim's review chose Sans plus Mono for that reason.
- **Bundling:** vendor the `.woff2` files into `apps/web/src/fonts/` with `OFL.txt`, declare them with `@font-face` in `index.css`, and let Vite fingerprint them.
  This matches sink (`src/styles/fonts`) and slim (`design_system/fonts`), adds no runtime dependency, and passes the server's `default-src 'self'` CSP with no change.
  No Google Fonts, no CDN, no `@fontsource` runtime import from a third-party host.
- **Files:** Plex Sans 400, 500, 600 (plus 400 italic for quoted mail) and Plex Mono 400, 500, 600, latin and latin-ext subsets, `font-display: swap`.
- **Weights:** 400 body, 500 labels and nav, 600 titles and emphasis; never 700 (slim cap, echo "prefer 600").
- **Mono does real work** (slim 0004: "lean on mono harder"): request references, domains, email addresses, timestamps and dates in tables and timelines, all counts and numbers, section labels, column headers, keycaps, the version string, the wordmark, units ("of 150", "45 d").
- All numbers use `font-variant-numeric: tabular-nums`.

**Scale.**

| Token | Size / line | Family, weight, tracking | Use | Evidence |
|---|---|---|---|---|
| `label` | 11 / 14 | Mono 500, +0.07em, uppercase | section labels, column headers, tags | slim label 11/600/+0.07em, sink 12 uppercase |
| `caption` | 12 / 16 | Sans 400 | timestamps under text, footnotes | slim caption 12, echo bodySmall 12 |
| `meta` | 13 / 18 | Sans 400 or Mono 400 | secondary row text, domains, help text | sink `--fs-meta` 13, echo bodyMedium 13 |
| `ui` | 14 / 20 | Sans 400/500 | default UI text, table cells, buttons, nav | slim ui 14, current base 14 |
| `body` | 15 / 22 | Sans 400 | reading text: email bodies, explanations | slim body 15/1.45, echo 15/1.47, sink 15 |
| `heading` | 18 / 24 | Sans 600 | dialog titles, detail page section titles | between slim 20 and echo 16; 17 was deleted in slim, so use 18 |
| `title` | 22 / 28 | Sans 600, -0.01em | page title | sink `--fs-h2` 22, echo headlineMedium 22 |
| `numeral` | 28 / 32 | Mono 500, tabular | the few big counts on the dashboard | sink bold-on-dim readouts |

- Phone keeps the same scale; the title drops to 20 and inputs stay 16px to stop iOS zoom (already in place).
- Nothing below 11px, and 11px only for uppercase labels (echo rule).

### 3.3 Spacing, radius, borders, elevation

- **Spacing scale:** 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 48.
  14 is a real step (sink), and 10/6/14 are the named rhythm insets (slim: 10 above a section label, 6 below it, 14 above a divider band).
- **Gutter:** 20px desktop (slim pane gutter), 16px phone (echo and current).
- **Control heights:** 28 small, 34 default, 40 large on desktop; 44 on phone (slim sizes, current phone rule).
- **Row heights:** 36 for table and list rows on desktop, 44 on phone; two-line rows 52 maximum.
- **Bars:** header bar 48, phone top bar 52.
- **Radius scale:** `xs 4` (tags, keycaps, checkbox), `sm 6` (buttons, inputs, selects, tabs), `md 10` (row groups, tables, callouts), `lg 12` (dialogs, popovers, the login panel), `full` (toggles, meters, avatars, status dots only).
  This is slim's 6/10 pair with sink's 12 for floating windows, and it stays under echo's 14 cap.
- **Borders:** 1px `--kr-line` separates everything; row dividers are 1px inside a group, never a gap plus a border.
- **Elevation:** tone first, border second, shadow only for floating layers.
  Popovers and menus: `0 16px 40px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4)` dark, `0 12px 32px rgba(15,17,19,.14), 0 1px 3px rgba(15,17,19,.08)` light (sink popover, slim menu).
  Dialogs: `0 18px 50px rgba(0,0,0,.5)` dark, `0 20px 48px rgba(15,17,19,.18)` light (sink modal).
  Sticky bars (campaign send bar, table header) get a hairline, not a shadow.
- **Focus vs selection:** focus is a 2px `--kr-focus` outline with 2px offset; selection is `accent-soft` fill plus a 3px left marker.
  They must never look alike (slim rule).

### 3.4 Density

- Compact by default, like sink and echo: 14px UI text, 36px rows, 34px controls on desktop.
- Show 50 rows per page on Targets and Requests instead of 25.
- Settings becomes rows with values on the right, not stacked forms.
- No per-field help text unless the field is genuinely ambiguous.

### 3.5 Layout and navigation

- **Rail** (`--kr-rail`, 216px, 1px right border): 22px mark plus mono wordmark at the top, profile switcher, then two nav groups (work: Dashboard, Review, Requests, Targets; setup: Profiles, Settings), with About and the mono version pinned at the bottom (sink, echo, npc-shelf).
- Put Review second, because it is where the person acts.
- **Nav rows:** 32px, 14px Sans 500, 16px icons at 1.5 stroke in `ink-3`.
  Active is `accent-soft` fill, `accent-text` label and icon, and a 3px by 18px `accent-fill` tab on the left edge with `0 3px 3px 0` radius (sink `.nav-item.active::before`, slim marker).
- Review count is a right-aligned mono tabular number in `attention-text`, no pill.
- **Header bar** (48px, `--kr-rail`, 1px bottom border) across the content area, sink's headerbar adapted.
  Left: breadcrumb in 13px (`Requests / Fixture Verify Data`), with the reference in mono.
  Right: up to three status chips, each a pill with a 1px border, a 6px dot with a 3px halo, and 12px text (sink `.hb-status`): `Worker online`, `Inbox 7m ago`, `Sent 1/150 today`.
  A `MOCK` mono tag sits here in mock mode.
- **Content** is left-aligned with the 20px gutter.
  Tables and the review queue use the full width.
  Forms, detail summaries and settings cap at 720px and stay left; the empty right side is accepted (sink, slim).
- **Page header:** a 22px title with a muted 13px subtitle on the same baseline, then the page actions on the right, then a hairline (sink Apps: "Applications  Route each app's audio to a channel").
  Subtitles are 8 words or fewer, or absent.
- **Sections:** an 11px mono uppercase label with the count folded in (`NEEDS YOU · 11`, `SCHEDULE`, `WORKER · ONLINE`), then one bordered group of rows.
  No section ever has a title plus a description inside a card.
- **Phone (under 640px):** 52px top bar with menu, mark and the most urgent status dot; the rail becomes the existing drawer; lists drill down to a detail page with back (slim compact rule).
  Layout follows width, never platform (slim).

### 3.6 Signature components

**Status mark** (replaces `StatusPill` and `TaskStatusPill`).
- A 10px shape plus a plain word, with no pill background and no lucide icon (slim presence shapes, echo "no colour-only status").
- Shapes and families, matching the dashboard groups:
  - In progress, waiting on someone else: hollow ring in `ink-3` (Draft uses a dashed ring, Queued a ring, Sent and Awaiting reply a ring in `accent-text`).
  - Resolved: filled disc in `positive` (Confirmed, No record); Cancelled is a short dash in `ink-3`.
  - Needs you: filled triangle in `attention` (Needs verification, Follow-up due, No response).
  - Failed: filled square in `danger` (Rejected, Bounced, task Failed).
  - Running: ring with a 1.2s rotating gap, frozen under reduced motion.
- The word is 13px Sans in `ink-2`; only the Needs you and Failed words take their tone color.
- Description goes in the custom tooltip, not `title`.

**Tag** (replaces most of `Badge`'s 101 uses).
- 11px mono uppercase, +0.06em, 1px `--kr-line` border, `xs` radius, `ink-2` text, 18px tall (slim role badge, echo outlined chips).
- No tinted backgrounds; the only toned tag is `attention` outline for requirements that need the person (CAPTCHA, phone call, paid, account).
- Where a fact is just text ("Email or web form", "None"), print text, not a tag.
  Empty cells get a muted `-`, never the word "None".

**Ledger table** (restyles `Table.tsx`, used by Targets, Requests, Profiles, Scans).
- Header row: 32px, 11px mono uppercase `ink-3` labels, 1px bottom border, sticky.
- Body rows: 36px single line; the identifier column may add a second line in 12px mono `ink-3` (domain or reference) for a 52px row.
- Numbers and dates right-aligned, tabular mono.
- Hover is a `--kr-hover` fill; selected rows get `accent-soft` plus the 3px marker; row actions (open, delete, retry) appear on hover or focus (sink corner buttons, slim kebab).
- Toolbar above the table on one line: search field (280px), then compact filter selects that show their value ("Type: all"), then a right-aligned mono count (`932 targets`).
- Pagination: `1-50 of 932` in mono, previous and next as 28px icon buttons.
- Targets columns: Target (name 14/500 plus mono domain), Category, Priority, Contact, Needs, Scan, Removal.
  Priority is a mono word in `ink-2` with crucial in `ink` 600, or a three-step bar glyph, never a tinted pill.
  Scan and Removal are two status marks, not four tags.
- Requests columns: Target (name plus mono reference), Status (mark), Asked (`opt-out`, `delete` as mono tokens joined by a middle dot), Channel, Sent, Due.

**Review queue** (restyles `pages/review/*`).
- Split pane on desktop (at 1024px and up): a 360px list on the left grouped under mono section labels by kind (`BLOCKED · 3`, `RECORDS · 3`, `DETAILS ASKED · 2`, `UNSORTED MAIL · 2`, `FAILED · 1`), and the selected item on the right.
  This is echo's sidebar plus canvas and slim's list plus transcript, applied to a queue.
- The tabs become the left list's group labels, so every waiting item is visible in one place; Scans and the agent queue move to their own small sections at the bottom of the list or into Requests.
- List rows: 44px, title (target or sender) in 14/500, one line of reason in 13px `ink-3`, mono age on the right, status shape on the left.
- Detail pane: the facts as a compact definition list, the message body in 15px reading text with a 2px left rule for quoted mail, and the decision controls in a footer bar pinned to the bottom of the pane.
- Keyboard: `j` and `k` move, `Enter` opens, `1` to `4` pick a classification, shown as mono keycaps in the footer (slim and echo show shortcuts inline).
- One filled primary per item; the alternative ("Send nothing and cancel") is a secondary button; the disabled primary is `--kr-active` fill with `ink-3` text, not a washed accent.
- Phone: the list is the page and an item drills down to the detail with back.
- After a decision the next item is selected automatically, with a toast only for confirmation ("Sent date of birth to ClearCheck").

**Campaign builder** (restyles `pages/campaigns/new/*`).
- Two columns on desktop: choices on the left (max 480px), the live preview on the right, so the empty half of the screen becomes the most useful part.
- Choices are row groups: `WHO` as four selectable rows with a radio, a 14px name and a 13px count in mono on the right (`412 targets`), and `ASK FOR` as two checkbox rows.
  Per-option descriptions shrink to one short clause or move into the tooltip.
- The preview is a console readout: mono counts by channel (`email 312`, `web form 88`, `scan first 12`), a list of the first targets, and warnings as attention text.
  It is visible from the start with zeros, rather than hidden behind a sentence.
- The send bar is a sticky footer with a 1px top border, a mono summary on the left (`400 requests · opt-out, delete`) and the single primary on the right; no shadow.
- The confirm dialog repeats the count and the law in mono.

**Timeline** (restyles `pages/requests/detail/Timeline.tsx`).
- A left gutter with the mono time (`09:02`, then `Oct 6` for older days), the status shape on a 1px vertical rule, and one line of text (slim transcript gutter, sink's indented left rule).
- Consecutive events within a minute group under one time.
- Status changes fold into the event that caused them ("Sent the email", not a separate "Status changed from Queued to Sent").
- The actor shows only when it is the person ("you approved sending date of birth"); system events need no "by Kick Rocks".
- Only Needs you and Failed events take color; everything else is `ink-3` shapes.
- An error appears once, on the event that failed, in `danger-text`, with Retry beside it.

**Meter** (new, sink's one earned hardware touch).
- A 6px pill track in `--kr-active` with an `accent-fill` bar, mono readout on the right (`1 of 150`), and tick marks at 50% and 80%.
- Used for the daily send quota, scan progress and reply-due windows (`due in 12 d` with the bar showing elapsed time, turning `attention` past 80%).
- Fill transitions 120ms linear; no gradient except the calibrated green-amber-red one if a zoned meter is ever needed.

**Row group** (replaces `Card` for most uses, sink `.row`).
- A 1px bordered `md`-radius box of rows divided by hairlines.
- Each row: optional 32px rounded-square icon tile (`--kr-active` fill, 16px `ink-2` glyph), a 14px title, a 13px `ink-3` description of at most one line, and a trailing control or value.
- Settings, About, Profile detail, Mailbox and the dashboard's Needs you list all use it.
- `Card` stays only for genuinely bounded objects (a dialog body, the login panel).

**Forms and fields** (restyles `Field.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`, `Checkbox.tsx`, `Radio.tsx`).
- Label 12px Sans 500 `ink-2` above the control, 6px gap (check-in `FieldLabel`).
- Control: 34px, `--kr-field` fill (inset in dark), 1px `line-strong` edge, `sm` radius, 14px text; mono variant for emails, URLs, model names and numbers.
- Focus: edge becomes `accent-fill` plus the 2px outline.
- Error: edge `danger`, 12px `danger-text` message under the field with no icon; errors land on the failing field (slim).
- Help text only where a field is ambiguous, 12px `ink-3`, one clause, never stating a default (slim wording gate).
- Settings forms become rows: label on the left, control on the right (180px for numbers with a mono unit suffix: `45 d`, `1 min`), saved per section with one button at the section's end.

**Buttons** (restyles `Button.tsx`, `IconButton.tsx`).
- Primary: `accent-fill`, `accent-on`, 14px Sans 600, `sm` radius, one per screen (slim).
- Secondary: transparent, 1px `line-strong` edge, `ink` text.
- Ghost: `ink-2` text, hover fill only.
- Danger: outlined in `danger` with `danger-text`, never filled (slim); the confirm dialog's final button may fill.
- Disabled: `--kr-active` fill, `ink-3` text, no opacity trick.
- Press: 100ms, `scale(0.98)` (slim pressScale).
- Icons inside buttons only when the icon disambiguates (external link, copy); "New campaign" and "New profile" are words.

**Tabs** (restyles `Tabs.tsx`, kept for Settings sub-pages).
- 14px Sans 500 `ink-3`, active `ink` with a 2px `accent-fill` underline; counts as mono `· 3` in the same color, never a tinted chip.

**Callout** (restyles `Alert.tsx`).
- 1px tone border (`attention` or `danger`) on `--kr-surface`, `md` radius, 13px text, one line where possible, inline action on the right.
- No filled tinted backgrounds (echo: "warning banners use warning border and icon, not full red").

**Tooltip** (new, replaces 30 `title` attributes).
- `--kr-popover` with `line-popover` edge, `xs` radius, 12px text, 600ms delay, no arrow (sink 1200ms, echo 500ms; split the difference for a web app).

**Keycap and command palette** (phase 3).
- 11px mono keycaps with a 1px border (slim kbd chip).
- `Ctrl K` opens a palette to jump to a target, request or review item (slim search chip, npc-shelf `SearchCommand`).

**Skeleton** (restyles `Skeleton.tsx`).
- `--kr-active` blocks shaped like the real rows, opacity pulse 0.35 to 0.7 over 900ms (check-in), no shimmer.

**Placeholder hatching** (slim).
- Missing screenshots in Review (blocked tasks) and missing target logos use a 45-degree hatch of `ink-3` at 8% instead of a grey block.

### 3.7 Icons

- Keep `lucide-react` (already a bundled dependency, and slim's chosen set), but set `strokeWidth={1.5}` everywhere through one wrapper (slim's weight-300 cut at 1.5px).
- Sizes: 16 in rows, buttons and nav; 20 in the header bar and empty states; 14 only inline in text.
- Color: `ink-3` by default, `ink-2` on hover, `accent-text` only for the active nav item (5/5 projects use muted icons).
- Remove icons from status (shapes replace them), from primary buttons, and from section labels.
- Icons that stay: nav, row-leading tiles in row groups, toolbar actions, external-link and copy affordances.
- The logo mark becomes a 22px rounded-square tile (`xs` 5px radius) in `accent-fill` with the pebble in `accent-on`, beside a mono 14px/600 `kick rocks` or `Kick Rocks` wordmark with +0.02em tracking (sink 22px tile and 14/600 title, slim mono wordmark).

### 3.8 Motion

| Token | Duration | Curve | Use | Evidence |
|---|---|---|---|---|
| `--kr-fast` | 100ms | ease-out | hover fill, press, color changes | slim fast 100, echo instant 80, sink 0.12s |
| `--kr-base` | 160ms | cubic-bezier(.33,1,.68,1) | selection marker, nav tab, drawer, tab underline | slim base 180, echo quick 150, sink toggle 0.15s |
| `--kr-slow` | 240ms in, 160ms out | ease-out-cubic in, ease-in out | dialogs, popovers, toasts | slim slow 280/180, sink stripIn 0.24s |
| `--kr-pulse` | 900ms alternate | ease-in-out | skeleton only | check-in |

- The selection marker grows from its center on `--kr-base` while the hover fill runs on `--kr-fast` (slim).
- New review items and toasts enter with a 6px rise and fade on `--kr-slow`; nothing else animates on mount.
- No bounce, spring, parallax, page transitions or shimmer (echo anti-goals).
- Theme switching is instant (slim).
- Keep the existing global reduced-motion block.

### 3.9 Empty and error states

- Empty: one sentence in 14px `ink-2`, left-aligned at the top of where the content would be, plus at most one text link or secondary button (sink "No apps are playing audio.", slim `SettingsEmpty`, check-in, npc-shelf).
  No centered icon, no card, no title plus description.
  Examples: `Nothing needs you.`, `No requests yet.
  Start a campaign.`, `No targets match these filters.`
- Loading: skeleton rows shaped like the content, never a centered spinner for a list.
- Errors attach to what failed (slim): a field error under the field, a task error on the task row and timeline event, a failed page load as one line with Retry where the content would be.
- Transient trouble (inbox unreachable, worker offline) is `attention`; a failure that needs action is `danger`, outlined.
- Toasts are only for confirming something the person just did; errors never toast.
- Route errors and 404s show a plain sentence and a link home, never a raw exception string (echo's leaked `GoException` is the counterexample).

### 3.10 Copy

- Sentence case everywhere, including buttons and tabs (fixes echo's mixed casing).
- Page subtitles 8 words or fewer, or none: `Dashboard  where requests stand`, `Requests  every request for Jordan`, `Targets  932 brokers and companies`.
- Section labels name the thing and carry the count: `NEEDS YOU · 11`, `IN PROGRESS · 13`, `PRIVACY LAWS · 31 STATES`.
- Settings rows: label at most 5 words, description at most one sentence of 12 words, never state a default, never explain the implementation (slim wording gate).
  `Check inbox every` with value `1 min`; `Wait for a reply` with `45 d`; `Follow-ups` with `2`.
- One word per thing: choose `target` for brokers and companies in UI chrome, `request` for a sent ask, `record` for a scan match, `profile` for a person; do not mix `site`, `listing`, `broker` and `company` in labels (slim one-name-per-thing rule).
- Status text is a plain state: `Worker online`, `Inbox checked 7m ago`, `Sent 1 of 150 today`.
- Relative times are short (`7m ago`, `2h`, `yesterday`, `next month`) and exact times live in the tooltip.
- Remove self-reference where it adds nothing: "Kick Rocks is unsure what this is" becomes the reason line alone; "by Kick Rocks" disappears.
- No exclamation marks, no em dashes, no "Learn more" without a real destination.

---

## 4.
Implementation plan

Work on a branch, keep the token rename mechanical, and verify each phase visually before the next.
`pages/dev/ui` (served at `/dev/ui` in `vite --mode mock`) is the gallery for checking every component in both themes before touching pages.

### 4.1 Phase 0: foundations (one PR)

1. `apps/web/src/fonts/` (new): IBM Plex Sans 400, 400 italic, 500, 600 and IBM Plex Mono 400, 500, 600 as latin and latin-ext `.woff2`, plus `OFL.txt`.
2. `apps/web/src/index.css`:
   replace the oklch ramp with the hex tokens in 3.1 for both schemes (keep `light-dark()` and the `data-theme` pins);
   split the accent into `accent-fill`, `accent-on`, `accent-text`, `accent-soft`;
   replace the eleven `[data-tone]` blocks with `positive`, `attention`, `danger` and `neutral`, each with an `-rgb` triplet;
   add `@font-face` rules, set `--font-sans` to Plex Sans and `--font-mono` to Plex Mono with the current stacks as fallbacks;
   replace the text scale with 3.2 (`label`, `caption`, `meta`, `ui`, `body`, `heading`, `title`, `numeral`) and set `font-variant-numeric: tabular-nums` on mono;
   set radius to `xs 4`, `sm 6`, `md 10`, `lg 12`;
   set shadows to the menu and dialog values in 3.3;
   add the motion tokens in 3.8;
   set `--kr-gutter` to 20px desktop and 16px phone and `--kr-control-h` to 34px desktop and 44px phone;
   default to dark when no `data-theme` is set and the OS gives no preference.
3. `apps/web/src/lib/tone.ts`: shrink `TONES` to the four families and keep `INTENT_TONE` mapping `info` to `neutral`.
4. `apps/web/src/lib/status.ts`: replace `icon` and `tone` with `family` (`progress`, `resolved`, `needs`, `failed`, `closed`) and `shape`; keep labels and descriptions.
5. Verify: `/dev/ui` tokens page in both themes at 1280 and 390; fonts load from the app origin only (Network panel shows no third-party request and no CSP error); contrast of every text token against `canvas` and `surface` meets the ratios in 3.1.

### 4.2 Phase 1: primitives (one PR)

1. `components/ui/StatusPill.tsx`: becomes `StatusMark` (shape plus word), keeping the exported names as aliases until pages move.
2. `components/ui/Badge.tsx`: becomes the outlined mono `Tag`.
3. `components/ui/Card.tsx`: add `Section` (mono label with count plus actions) and `RowGroup` and `Row`; keep `Card` for dialogs and login only.
4. `components/ui/Table.tsx`: header, row height, sticky header, hover-revealed actions, mono numeric cells; `Pagination.tsx` mono range.
5. `components/ui/Button.tsx` and `IconButton.tsx`: sizes 28/34/40, outlined danger, disabled style, press scale, 1.5 stroke icons.
6. `components/ui/Field.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`, `Checkbox.tsx`, `Radio.tsx`: inset field, label and error rules, mono variant, row layout variant for settings.
7. `components/ui/Tabs.tsx`: underline and mono counts.
8. `components/ui/Alert.tsx`: outlined callout; `Toast.tsx`: confirmations only, outlined in tone.
9. `components/ui/EmptyState.tsx`: one left-aligned sentence plus an optional action.
10. `components/ui/Skeleton.tsx`: opacity pulse.
11. New: `Tooltip.tsx`, `Meter.tsx`, `Kbd.tsx`, `Hatch.tsx`, and an `Icon` wrapper that fixes size and stroke.
12. `components/ui/PageHeader.tsx`: inline title and subtitle, hairline below.
13. `pages/dev/ui/*`: show every new primitive in every state (hover, focus, selected, disabled, error, loading, empty).
14. Verify: gallery screenshots in both themes at 1280 and 390; focus ring and selection marker side by side look clearly different; only one filled primary per gallery panel; no shadow on anything that does not float.

### 4.3 Phase 2: shell, then screens in order of how often they are used

1. `components/layout/AppLayout.tsx`: header bar with breadcrumb and status chips, left-aligned content, remove `mx-auto max-w-6xl`.
2. `components/layout/Sidebar.tsx`, `nav.ts`, `Logo.tsx`, `ProfileSwitcher.tsx`, `ThemeToggle.tsx`: 216px rail, nav order with Review second, left tab marker, mono count, mono wordmark, `MOCK` tag moved to the header.
3. `pages/review/*`: split-pane queue, keyboard, pinned decision footer, auto-advance.
4. `pages/dashboard/index.tsx`, `sections.tsx`: `NEEDS YOU` row group first and full width, then one line of mono counts per family with a single stacked bar (`IN PROGRESS 13 · RESOLVED 11 · NEEDS YOU 9`), then the send-quota meter, then recent activity as a compact timeline.
5. `pages/requests/index.tsx`, `pages/requests/detail/index.tsx`, `Timeline.tsx`: ledger table, single error placement, grouped timeline with time gutter.
6. `pages/targets/index.tsx`, `RequirementBadges.tsx`, `Automation.tsx`, `LoadingRows.tsx`, `targets/detail`: ledger table, one-line toolbar, tags only for requirements that need the person, two status marks for automation, 50 per page.
7. `pages/campaigns/new/index.tsx`, `PreviewPanel.tsx`: two-column builder with the always-visible preview and hairline send bar.
8. `pages/settings/*` (`ScheduleCard.tsx`, `WorkerCard.tsx`, `LlmCard.tsx`, `JurisdictionsCard.tsx`, `PasswordCard.tsx`, `RetentionCard.tsx`, `SiteChecksCard.tsx`, `ResetCard.tsx`, `RecipeCard.tsx`, `SettingsHeader.tsx`, and the `agents`, `notifications`, `recipes` sub-pages): settings rows with values on the right; privacy laws become a dense two-column table of states with laws, with the 0-law states folded into one line (`20 states have no law on file`).
9. `pages/profiles/*`, `pages/mailbox/*`: row groups, hover-revealed delete, outlined callouts in the wizard.
10. `pages/about/index.tsx`: row groups, mono version and counts.
11. `pages/login/*`, `pages/setup/*`, `pages/not-found/index.tsx`, `components/layout/RouteError.tsx`: panel at 360px with the mark and mono wordmark, plain error sentences.
12. Verify after each screen (see 4.5).

### 4.4 Phase 3: signature extras

1. `Ctrl K` command palette with keycap hints.
2. Profile attribution color on the switcher when more than one profile exists.
3. Optional named themes over the same role set (sink and echo ship them), for example a Gruvbox or Tokyo Night variant, only after the default theme is locked.

### 4.5 What to verify visually

Use `chrome-devtools-axi` against `pnpm --filter @kickrocks/web dev:mock` and the e2e stack, at 1280 by 900 and 390 by 844, in dark and light, for every route.
- **Side-by-side render:** one dashboard and one review screen next to `sink/docs/apps.png` and `slim-m-renders/compare-full.png` at the same scale; they should look like the same family.
- **Accent audit:** count accent-colored pixels or elements per screen; anything outside the allowed list in 3.1 is a bug.
- **Accent decision:** render the dashboard and review queue with indigo and with cyan, plus a deuteranopia simulation (Chrome DevTools Rendering panel, "Emulate vision deficiencies"), and let Nick pick from the renders, as slim did.
- **Typography:** computed `font-family` resolves to IBM Plex on every text node; no text under 11px; mono is used for every reference, domain, email, timestamp and count; numerals align in table columns.
- **Rhythm:** table rows are 36px (52px with a second line), controls 34px desktop and 44px phone, header bar 48px, gutter 20px desktop and 16px phone.
- **Elevation:** only menus, popovers, tooltips, toasts and dialogs have a `box-shadow`.
- **States:** hover, focus, selected, disabled, loading, empty and error for each table, the review queue and every form; focus and selection look different.
- **Phone:** no horizontal page scroll, tables scroll inside their frame with the edge shade, the review queue drills down, touch targets are 44px.
- **Privacy:** the Network panel shows no request leaving the app origin on any route, including fonts.
- **Reduced motion:** with the OS setting on, nothing moves, and the running status shape is static.
- **Long content:** a target with a long name, a 932-row target list, a 20-item review queue and a request with 40 timeline events, so truncation and grouping hold.
- **Tests:** update the existing vitest suites that assert on pill text or tone attributes, and keep `pnpm -r typecheck`, `pnpm -r test` and Biome clean.

### 4.6 Risks

- Indigo can still read as generic if it leaks beyond the allowed roles; the accent audit is the guard.
- Cutting help text removes guidance a new user may need; move it into tooltips and the first-run setup rather than deleting it outright.
- The review split pane changes a workflow that tests cover; land it behind the same routes and keep the existing actions and labels so tests mostly need selector updates.
- Status shapes need a legend once (in the status tooltip and on the dashboard), since shape is new vocabulary for users.
