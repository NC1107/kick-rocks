import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import { TASK_KIND_LABELS } from "../../lib/labels.js";
import { paths, type ReviewKey, type TaskRef, taskPath } from "../../lib/paths.js";
import { type FromState, useCurrentPage } from "./PageBack.js";
import { TextLink } from "./TextLink.js";

export type EntityRef =
  | { kind: "request"; id: string; reference?: string | undefined; targetName?: string | undefined }
  | { kind: "target"; id: string; name: string }
  | { kind: "profile"; id: string; name: string }
  | { kind: "mailbox"; profileId: string; address: string }
  | { kind: "task"; task: TaskRef; label?: string | undefined }
  | { kind: "campaign"; id: string; label?: string | undefined }
  | { kind: "review"; key: ReviewKey; label: string };

export interface EntityLinkProps {
  to: EntityRef;
  /** "inline" is the accent link in running text, "quiet" suits a meta line, and "row" makes the whole row the tap target. */
  variant?: "inline" | "quiet" | "row";
  /** For a request, whether to show the target's name, the reference, or both. */
  show?: "name" | "ref" | "both";
  /** Replaces the text the reference would show. */
  children?: ReactNode;
  className?: string | undefined;
}

interface Resolved {
  href: string | null;
  text: string;
  /** References and addresses are data, so they are set in mono. */
  mono: boolean;
}

/** Where a reference leads, and what it says by default. A missing id leads nowhere. */
export function resolveEntity(ref: EntityRef, show: EntityLinkProps["show"]): Resolved {
  switch (ref.kind) {
    case "request": {
      const name = ref.targetName;
      const reference = ref.reference;
      const mode = show ?? (name ? "name" : "ref");
      const text =
        mode === "both" && name && reference
          ? `${name} ${reference}`
          : mode === "ref"
            ? (reference ?? name ?? "Request")
            : (name ?? reference ?? "Request");
      return {
        href: ref.id ? paths.request(ref.id) : null,
        text,
        mono: mode === "ref" && Boolean(reference),
      };
    }
    case "target":
      return { href: ref.id ? paths.target(ref.id) : null, text: ref.name, mono: false };
    case "profile":
      return { href: ref.id ? paths.profile(ref.id) : null, text: ref.name, mono: false };
    case "mailbox":
      return {
        href: ref.profileId ? paths.mailbox(ref.profileId) : null,
        text: ref.address,
        mono: true,
      };
    case "task":
      return {
        href: taskPath(ref.task),
        text: ref.label ?? TASK_KIND_LABELS[ref.task.kind],
        mono: false,
      };
    case "campaign":
      return {
        href: ref.id ? paths.campaign(ref.id) : null,
        text: ref.label ?? "Campaign",
        mono: false,
      };
    case "review":
      return { href: paths.review(ref.key), text: ref.label, mono: false };
  }
}

const QUIET_CLASS =
  "rounded-xs text-ink-2 transition-colors duration-100 hover:text-accent-text focus-visible:-outline-offset-2";

// The stretched box makes the whole row the tap target, so its parent must be `relative`.
const ROW_CLASS =
  "rounded-xs text-ink after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:-outline-offset-2 focus-visible:underline";

/**
 * The one link for anything the app talks about, so a name or reference reads the same wherever it
 * appears and always leads to its page. It leaves the page it is on in `location.state`, which
 * PageBack uses to lead the person back.
 */
export function EntityLink({ to, variant = "inline", show, children, className }: EntityLinkProps) {
  const from = useCurrentPage();
  const { href, text, mono } = resolveEntity(to, show);
  const content = children ?? text;
  const monoClass = children === undefined && mono ? "font-mono text-[0.9em]" : undefined;

  if (!href) return <span className={cn(monoClass, className)}>{content}</span>;

  const state: FromState = { from };
  if (variant === "inline") {
    return (
      <TextLink to={href} state={state} className={cn(monoClass, className)}>
        {content}
      </TextLink>
    );
  }
  return (
    <Link
      to={href}
      state={state}
      className={cn(variant === "row" ? ROW_CLASS : QUIET_CLASS, monoClass, className)}
    >
      {content}
    </Link>
  );
}
