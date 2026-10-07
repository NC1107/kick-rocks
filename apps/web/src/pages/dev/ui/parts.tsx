import type { ReactNode } from "react";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-2xl text-base text-ink-muted">{description}</p>
      ) : null}
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-medium text-ink-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
