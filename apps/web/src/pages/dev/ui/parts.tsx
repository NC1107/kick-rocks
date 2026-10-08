import type { ReactNode } from "react";

/** A gallery panel: a title, one line about it, then specimens. Not the app's Section. */
export function Panel({
  title,
  description,
  first,
  children,
}: {
  title: string;
  description?: string;
  /** The panel right under the page header, which already has a hairline. */
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={first ? "pb-7" : "border-t border-line py-7"}>
      <h2 className="text-heading font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1 max-w-2xl text-ui text-ink-2">{description}</p> : null}
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <p className="text-eyebrow text-ink-3">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** The focus ring, forced on, so a screenshot can show it beside the other states. */
export const FORCE_FOCUS = "outline-2 outline-offset-2 outline-solid outline-focus";
export const FORCE_FOCUS_FIELD =
  "border-accent-fill outline-2 outline-offset-0 outline-solid outline-focus";
