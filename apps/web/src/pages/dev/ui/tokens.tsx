import { Logo, LogoMark } from "../../../components/layout/Logo.js";
import { Badge } from "../../../components/ui/index.js";
import { TONES } from "../../../lib/tone.js";
import { Section, Specimen } from "./parts.js";

const SURFACES = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["raised", "bg-raised"],
  ["sunken", "bg-sunken"],
  ["sidebar", "bg-sidebar"],
  ["field", "bg-field"],
  ["accent", "bg-accent"],
  ["accent-soft", "bg-accent-soft"],
  ["danger", "bg-danger"],
] as const;

const TEXT = [
  ["ink", "text-ink"],
  ["ink-muted", "text-ink-muted"],
  ["ink-faint", "text-ink-faint"],
  ["accent", "text-accent"],
  ["danger", "text-danger"],
] as const;

const SCALE = [
  ["text-3xl font-semibold tracking-tight", "3xl 28/34 semibold: page title on a wide screen"],
  ["text-2xl font-semibold tracking-tight", "2xl 22/28 semibold: page title"],
  ["text-xl font-semibold", "xl 18/26 semibold: dialog and section title"],
  ["text-lg font-semibold", "lg 16/24 semibold: card title"],
  ["text-base", "base 14/22 regular: body and controls"],
  ["text-sm", "sm 13/20 regular: help text, table headings"],
  ["text-xs", "xs 12/16 regular: badges, counts"],
] as const;

export function Tokens() {
  return (
    <>
      <Section
        title="Color"
        description="Neutrals carry a faint cool tint. Color is kept for meaning: the accent marks what you can act on, and tones mark state."
      >
        <Specimen label="Name and mark: the one playful thing">
          <LogoMark className="size-16" />
          <LogoMark className="size-7" />
          <Logo />
        </Specimen>
        <Specimen label="Surfaces">
          {SURFACES.map(([name, cls]) => (
            <div key={name} className="flex w-28 flex-col gap-1.5">
              <div className={`${cls} h-14 rounded-md border border-line`} />
              <span className="text-xs text-ink-muted">{name}</span>
            </div>
          ))}
        </Specimen>
        <Specimen label="Text">
          {TEXT.map(([name, cls]) => (
            <span
              key={name}
              className={`${cls} rounded-md border border-line bg-surface px-3 py-2 text-base`}
            >
              {name}
            </span>
          ))}
        </Specimen>
        <Specimen label="Tones (Badge soft and outline)">
          {TONES.map((tone) => (
            <div key={tone} className="flex flex-col items-start gap-1.5">
              <Badge tone={tone}>{tone}</Badge>
              <Badge tone={tone} variant="outline">
                {tone}
              </Badge>
            </div>
          ))}
        </Specimen>
      </Section>

      <Section
        title="Type"
        description="System font stack, so nothing loads from a third party. Weights 400, 500, 600, and 700 for the name."
      >
        <div className="flex flex-col gap-3">
          {SCALE.map(([cls, note]) => (
            <div key={cls} className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className={`${cls} text-ink`}>Opt out, delete, repeat</span>
              <span className="text-sm text-ink-muted">{note}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Radius and elevation"
        description="Radius follows role. Only layers that float get a shadow; everything else is a hairline."
      >
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["xs 3px: checkbox", "rounded-xs"],
              ["sm 4px: badge", "rounded-sm"],
              ["md 6px: control", "rounded-md"],
              ["lg 10px: card", "rounded-lg"],
              ["xl 14px: dialog", "rounded-xl"],
            ] as const
          ).map(([label, cls]) => (
            <div
              key={label}
              className={`${cls} flex h-16 w-36 items-center justify-center border border-line-strong bg-surface text-sm text-ink-muted`}
            >
              {label}
            </div>
          ))}
          <div className="flex h-16 w-36 items-center justify-center rounded-lg border border-line bg-raised text-sm text-ink-muted shadow-pop">
            shadow-pop
          </div>
          <div className="flex h-16 w-36 items-center justify-center rounded-xl border border-line bg-raised text-sm text-ink-muted shadow-dialog">
            shadow-dialog
          </div>
        </div>
      </Section>
    </>
  );
}
