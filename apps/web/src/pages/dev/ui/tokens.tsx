import { Logo, LogoMark } from "../../../components/layout/Logo.js";
import { StatusShapeGlyph, Tag } from "../../../components/ui/index.js";
import { TONE_SHAPE } from "../../../lib/status.js";
import { TONES } from "../../../lib/tone.js";
import { Panel, Specimen } from "./parts.js";

const SURFACES = [
  ["frame", "bg-frame", "page behind everything"],
  ["rail", "bg-rail", "sidebar, header bar"],
  ["canvas", "bg-canvas", "content area"],
  ["surface", "bg-surface", "row groups, tables"],
  ["hover", "bg-hover", "row and control hover"],
  ["active", "bg-active", "pressed, track, disabled"],
  ["field", "bg-field", "inputs, inset"],
  ["popover", "bg-popover", "menus, dialogs"],
  ["popover-hover", "bg-popover-hover", "menu item hover"],
] as const;

const LINES = [
  ["line", "border-line", "hairlines, dividers"],
  ["line-popover", "border-line-popover", "floating layer edge"],
  ["line-strong", "border-line-strong", "control edge, 3:1"],
] as const;

const INK = [
  ["ink", "text-ink", "primary text"],
  ["ink-2", "text-ink-2", "secondary text"],
  ["ink-3", "text-ink-3", "muted text, labels"],
] as const;

const ACCENT = [
  ["accent-fill", "bg-accent-fill", "primary fill, marker, meter"],
  ["accent-fill-hover", "bg-accent-fill-hover", "primary hover"],
  ["accent-on", "bg-accent-on", "text on the fill"],
  ["accent-text", "bg-accent-text", "links, active nav"],
  ["accent-soft", "bg-accent-soft", "selection wash"],
  ["focus", "bg-focus", "focus ring"],
] as const;

const SCALE = [
  ["text-label", "font-mono font-medium uppercase tracking-[0.07em]", "label 11/14 mono"],
  ["text-caption", "", "caption 12/16 sans"],
  ["text-meta", "", "meta 13/18 sans or mono"],
  ["text-ui", "font-medium", "ui 14/20 sans 400 or 500"],
  ["text-body", "", "body 15/22 sans"],
  ["text-heading", "font-semibold", "heading 18/24 sans 600"],
  ["text-title", "font-semibold tracking-[-0.01em]", "title 22/28 sans 600"],
  ["text-numeral", "font-mono font-medium", "numeral 28/32 mono 500"],
] as const;

const RADII = [
  ["xs 4: tags, keycaps, checkbox", "rounded-xs"],
  ["sm 6: buttons, fields, tabs", "rounded-sm"],
  ["md 10: groups, tables, callouts", "rounded-md"],
  ["lg 12: dialogs, popovers", "rounded-lg"],
] as const;

const MOTION = [
  ["fast", "100ms ease-out", "hover fill, press, color"],
  ["base", "160ms ease-out-cubic", "marker, tab underline, drawer"],
  ["slow", "240ms in, 160ms out", "dialogs, popovers, toasts"],
  ["pulse", "900ms alternate", "skeleton only"],
] as const;

const SIZES = [
  ["control sm", "h-control-sm", "28 desktop, 44 phone"],
  ["control", "h-control", "34 desktop, 44 phone"],
  ["control lg", "h-control-lg", "40 desktop, 44 phone"],
  ["row", "h-row", "36 desktop, 44 phone"],
  ["bar", "h-bar", "48 desktop, 52 phone"],
] as const;

function Swatch({ name, cls, use }: { name: string; cls: string; use: string }) {
  return (
    <div className="flex w-36 flex-col gap-1.5">
      <div className={`${cls} h-12 rounded-sm border border-line-strong`} />
      <span className="font-mono text-meta text-ink">{name}</span>
      <span className="text-caption text-ink-3">{use}</span>
    </div>
  );
}

export function Tokens() {
  return (
    <>
      <Panel
        first
        title="Color"
        description="Dark is the reference. Neutrals step in small tonal layers. The accent is allowed on the primary button, links, active nav, selected tab, focus ring, row selection, checkbox and radio fills, and meter fills. Everything else that has color means state."
      >
        <Specimen label="Name and mark">
          <LogoMark className="size-16" />
          <Logo />
        </Specimen>
        <Specimen label="Surfaces">
          {SURFACES.map(([name, cls, use]) => (
            <Swatch key={name} name={name} cls={cls} use={use} />
          ))}
        </Specimen>
        <Specimen label="Lines">
          {LINES.map(([name, cls, use]) => (
            <div key={name} className="flex w-36 flex-col gap-1.5">
              <div className={`${cls} h-12 rounded-sm border-2 bg-surface`} />
              <span className="font-mono text-meta text-ink">{name}</span>
              <span className="text-caption text-ink-3">{use}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label="Ink">
          {INK.map(([name, cls, use]) => (
            <div
              key={name}
              className="flex w-36 flex-col gap-1 rounded-sm border border-line bg-surface px-3 py-2"
            >
              <span className={`${cls} text-ui font-medium`}>{name}</span>
              <span className="text-caption text-ink-3">{use}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label="Accent roles (switch the accent above)">
          {ACCENT.map(([name, cls, use]) => (
            <Swatch key={name} name={name} cls={cls} use={use} />
          ))}
          <div className="flex w-36 flex-col gap-1.5">
            <span className="flex h-12 items-center justify-center rounded-sm bg-accent-fill text-ui font-semibold text-accent-on">
              On fill
            </span>
            <span className="font-mono text-meta text-ink">fill + on</span>
          </div>
          <div className="flex w-36 flex-col gap-1.5">
            <span className="flex h-12 items-center justify-center rounded-sm bg-accent-soft text-ui font-medium text-accent-text">
              Selected
            </span>
            <span className="font-mono text-meta text-ink">soft + text</span>
          </div>
        </Specimen>
        <Specimen label="State families: shape fill, text, wash, halo">
          {TONES.map((tone) => (
            <div
              key={tone}
              data-tone={tone}
              className="flex w-44 flex-col gap-2 rounded-md border border-line bg-surface p-3"
            >
              <span className="flex items-center gap-2 text-ui text-tone-ink">
                <StatusShapeGlyph shape={TONE_SHAPE[tone]} />
                {tone}
              </span>
              <span className="rounded-xs bg-tone-bg px-2 py-1 font-mono text-caption text-tone-ink">
                rgb wash 12%
              </span>
              <Tag tone={tone}>{tone}</Tag>
            </div>
          ))}
        </Specimen>
      </Panel>

      <Panel
        title="Type"
        description="IBM Plex Sans for prose and controls, IBM Plex Mono for every identifier, number, date and label. Weights 400, 500, 600. Nothing under 11px, and 11px only for uppercase labels."
      >
        <div className="flex flex-col gap-3">
          {SCALE.map(([cls, extra, note]) => (
            <div key={cls} className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className={`${cls} ${extra} text-ink`}>Opt out, delete, repeat</span>
              <span className="font-mono text-caption text-ink-3">{note}</span>
            </div>
          ))}
        </div>
        <Specimen label="Weights and mono">
          <span className="text-body">400 regular</span>
          <span className="text-body font-medium">500 medium</span>
          <span className="text-body font-semibold">600 semibold</span>
          <span className="text-body italic">400 italic for quoted mail</span>
          <span className="font-mono text-ui tabular-nums">KR-7H3K2M 0123456789</span>
        </Specimen>
      </Panel>

      <Panel
        title="Radius, elevation, motion, size"
        description="Radius follows role. Tone first, border second, shadow only for layers that float."
      >
        <Specimen label="Radius">
          {RADII.map(([label, cls]) => (
            <div
              key={label}
              className={`${cls} flex h-14 w-44 items-center justify-center border border-line-strong bg-surface px-2 text-center text-caption text-ink-2`}
            >
              {label}
            </div>
          ))}
          <div className="flex h-14 w-44 items-center justify-center rounded-full border border-line-strong bg-surface px-2 text-center text-caption text-ink-2">
            full: toggle, meter, dot
          </div>
        </Specimen>
        <Specimen label="Elevation">
          <div className="flex h-14 w-44 items-center justify-center rounded-md border border-line bg-surface text-caption text-ink-2">
            flat: border only
          </div>
          <div className="flex h-14 w-44 items-center justify-center rounded-lg border border-line-popover bg-popover text-caption text-ink-2 shadow-pop">
            shadow-pop
          </div>
          <div className="flex h-14 w-44 items-center justify-center rounded-lg border border-line-popover bg-popover text-caption text-ink-2 shadow-dialog">
            shadow-dialog
          </div>
        </Specimen>
        <Specimen label="Motion">
          {MOTION.map(([name, value, use]) => (
            <div
              key={name}
              className="flex w-44 flex-col gap-0.5 self-stretch rounded-sm border border-line bg-surface px-3 py-2"
            >
              <span className="font-mono text-meta text-ink">--kr-{name}</span>
              <span className="font-mono text-caption text-ink-2">{value}</span>
              <span className="text-caption text-ink-3">{use}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label="Size">
          {SIZES.map(([name, cls, note]) => (
            <div key={name} className="flex w-36 flex-col gap-1.5">
              <div className={`${cls} w-full rounded-sm border border-line-strong bg-surface`} />
              <span className="font-mono text-meta text-ink">{name}</span>
              <span className="text-caption text-ink-3">{note}</span>
            </div>
          ))}
        </Specimen>
      </Panel>
    </>
  );
}
