import type { TaskSummary } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "../../lib/cn.js";
import { paths, type ReviewKey, taskPath } from "../../lib/paths.js";
import { breadcrumbTrail } from "../layout/breadcrumb.js";

export type EntityRef =
  | { kind: "request"; id: string | null; reference?: string | null; targetName?: string | null }
  | { kind: "target"; id: string | null; name: string }
  | { kind: "profile"; id: string | null; name: string }
  | { kind: "mailbox"; profileId: string | null; address: string }
  | {
      kind: "task";
      task: Pick<TaskSummary, "id" | "kind" | "status" | "requestId">;
      label?: string;
    }
  | { kind: "campaign"; id: string | null; label?: string }
  | { kind: "review"; key: ReviewKey; label: string };

export type EntityLinkVariant = "inline" | "quiet" | "row";

/** Where a reference leads, or null when it has no page of its own. */
export function entityPath(to: EntityRef): string | null {
  return resolve(to, undefined).path;
}

export interface EntityLinkProps {
  to: EntityRef;
  variant?: EntityLinkVariant;
  /** For a request: its reference, the target's name, or both. */
  show?: "name" | "ref" | "both";
  children?: ReactNode;
  className?: string | undefined;
  "aria-label"?: string;
}

interface Resolved {
  path: string | null;
  text: ReactNode;
}

function resolve(to: EntityRef, show: "name" | "ref" | "both" | undefined): Resolved {
  switch (to.kind) {
    case "request": {
      const reference = to.reference ? <span className="font-mono">{to.reference}</span> : null;
      const name = to.targetName ?? null;
      const mode = show ?? (reference ? "ref" : "name");
      const text =
        mode === "both" && reference && name ? (
          <>
            {reference} {name}
          </>
        ) : mode === "name" && name ? (
          name
        ) : (
          (reference ?? name ?? "Request")
        );
      return { path: to.id ? paths.request(to.id) : null, text };
    }
    case "target":
      return { path: to.id ? paths.target(to.id) : null, text: to.name };
    case "profile":
      return { path: to.id ? paths.profile(to.id) : null, text: to.name };
    case "mailbox":
      return {
        path: to.profileId ? paths.mailbox(to.profileId) : null,
        text: <span className="font-mono">{to.address}</span>,
      };
    case "task":
      return { path: taskPath(to.task), text: to.label ?? "Task" };
    case "campaign":
      return { path: to.id ? paths.campaign(to.id) : null, text: to.label ?? "Campaign" };
    case "review":
      return { path: paths.review(to.key), text: to.label };
  }
}

const VARIANTS: Record<EntityLinkVariant, string> = {
  inline:
    "text-accent-text underline decoration-accent-text/40 underline-offset-2 hover:decoration-accent-text",
  quiet: "text-ink-2 underline-offset-2 hover:text-accent-text hover:underline",
  row: "text-ink-2 underline-offset-2 after:absolute after:inset-0 after:content-[''] hover:text-accent-text",
};

/**
 * One link for each thing the app talks about, so a name or reference reads the same wherever it
 * appears and always leads to its page. It remembers the page it was clicked on, so the page it
 * opens can offer a way back to exactly there. A `row` link stretches over its nearest
 * positioned ancestor.
 */
export function EntityLink({
  to,
  variant = "inline",
  show,
  children,
  className,
  "aria-label": ariaLabel,
}: EntityLinkProps) {
  const location = useLocation();
  const { path, text } = resolve(to, show);
  const content = children ?? text;
  if (path === null) return <>{content}</>;
  const label = breadcrumbTrail(location.pathname).at(-1)?.label ?? "Back";
  return (
    <Link
      to={path}
      state={{ from: { path: `${location.pathname}${location.search}`, label } }}
      aria-label={ariaLabel}
      className={cn("rounded-xs focus-visible:-outline-offset-2", VARIANTS[variant], className)}
    >
      {content}
    </Link>
  );
}
