import type { TaskSummary } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { paths, taskPath } from "../../lib/paths.js";
import { TextLink } from "./TextLink.js";

interface LinkProps {
  children: ReactNode;
  className?: string | undefined;
}

/**
 * One link for each thing the app talks about, so a name or reference reads the same wherever it
 * appears and always leads to its page.
 */
export function RequestLink({ id, children, className }: LinkProps & { id: string }) {
  return (
    <TextLink to={paths.request(id)} className={className}>
      {children}
    </TextLink>
  );
}

export function TargetLink({ id, children, className }: LinkProps & { id: string }) {
  return (
    <TextLink to={paths.target(id)} className={className}>
      {children}
    </TextLink>
  );
}

export function ProfileLink({ id, children, className }: LinkProps & { id: string }) {
  return (
    <TextLink to={paths.profile(id)} className={className}>
      {children}
    </TextLink>
  );
}

export function MailboxLink({ profileId, children, className }: LinkProps & { profileId: string }) {
  return (
    <TextLink to={paths.mailbox(profileId)} className={className}>
      {children}
    </TextLink>
  );
}

/** Plain text when the task has nowhere of its own to open. */
export function TaskLink({
  task,
  children,
  className,
}: LinkProps & { task: Pick<TaskSummary, "id" | "kind" | "status" | "requestId"> }) {
  const to = taskPath(task);
  return to ? (
    <TextLink to={to} className={className}>
      {children}
    </TextLink>
  ) : (
    children
  );
}
