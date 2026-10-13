import { API_ROUTES, type Mailbox, type ProfileSummary } from "@kickrocks/shared";
import { type ReactNode, useState } from "react";
import { useApiQuery } from "../../api/index.js";
import {
  Callout,
  Disclosure,
  EmptyState,
  FactList,
  LinkButton,
  RelativeTime,
  Section,
} from "../../components/ui/index.js";
import { paths } from "../../lib/paths.js";

/** Why requests are waiting, shown while the server holds sending back after a mail server failure. */
export function SendPauseAlert({ mailbox }: { mailbox: Mailbox }) {
  if (!mailbox.sendPausedUntil || Date.parse(mailbox.sendPausedUntil) <= Date.now()) return null;
  return (
    <Callout intent="warning" title="Sending is paused" className="mb-3">
      The mail server could not be used, so requests wait and go out{" "}
      <RelativeTime iso={mailbox.sendPausedUntil} />. Saving the connection or testing it
      successfully starts sending again at once.
    </Callout>
  );
}

/**
 * Where the mailbox stands, state first: "Connected · requests go out from you@example.com ·
 * replies checked 7m ago". `lead` words the middle part for the page it sits on.
 */
export function MailboxStateLine({
  mailbox,
  lead,
  checked,
}: {
  mailbox: Mailbox;
  /** The words before the address, or none to show the bare address. */
  lead?: string;
  /** The words before the time of the last check. */
  checked: string;
}) {
  return (
    <span>
      {mailbox.lastError ? "Last check failed" : "Connected"}
      {" · "}
      {lead ? `${lead} ` : null}
      <span className="font-mono">{mailbox.address}</span>
      {" · "}
      {mailbox.lastPolledAt ? (
        <>
          {checked} <RelativeTime iso={mailbox.lastPolledAt} />
        </>
      ) : (
        "not checked yet"
      )}
    </span>
  );
}

/** The facts of a saved mailbox. The password is never among them: the server does not send it. */
export function MailboxFacts({
  mailbox,
  providerLabel,
  hideAddress = false,
  checkAction,
}: {
  mailbox: Mailbox;
  providerLabel: string;
  /** Leave the address out when a heading above already names it. */
  hideAddress?: boolean;
  /** The check-for-replies control, which sits beside the time it last ran. */
  checkAction?: ReactNode;
}) {
  return (
    <FactList
      dense
      items={[
        ...(hideAddress ? [] : [{ term: "Address", mono: true, value: mailbox.address }]),
        { term: "Provider", value: providerLabel },
        { term: "Sending", mono: true, value: `${mailbox.smtpHost}:${mailbox.smtpPort}` },
        { term: "Receiving", mono: true, value: `${mailbox.imapHost}:${mailbox.imapPort}` },
        { term: "Reply folder", mono: true, value: mailbox.replyFolder },
        { term: "Daily limit", mono: true, value: `${mailbox.dailyCap}/day` },
        {
          term: "Last checked",
          value: (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span className={mailbox.lastPolledAt ? "font-mono text-meta" : undefined}>
                {mailbox.lastPolledAt ? (
                  <RelativeTime iso={mailbox.lastPolledAt} />
                ) : (
                  "Not checked yet"
                )}
              </span>
              {checkAction}
            </span>
          ),
        },
      ]}
    />
  );
}

/** The connection's hosts, folder and limit, kept out of sight until someone goes looking for them. */
export function TechnicalDetails({
  mailbox,
  providerLabel,
  children,
}: {
  mailbox: Mailbox;
  providerLabel: string;
  /** Rows after the facts, such as the way to disconnect. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure title="Technical details" open={open} onOpenChange={setOpen} className="mt-4">
      <FactList
        dense
        items={[
          { term: "Provider", value: providerLabel },
          { term: "Sending", mono: true, value: `${mailbox.smtpHost}:${mailbox.smtpPort}` },
          { term: "Receiving", mono: true, value: `${mailbox.imapHost}:${mailbox.imapPort}` },
          { term: "Reply folder", mono: true, value: mailbox.replyFolder },
          { term: "Daily limit", mono: true, value: `${mailbox.dailyCap}/day` },
        ]}
      />
      {children}
    </Disclosure>
  );
}

export function useProviderLabel(providerId: string | undefined): string {
  const providers = useApiQuery(API_ROUTES.mailProviders, { staleTime: 5 * 60_000 });
  const preset = providers.data?.providers.find((candidate) => candidate.id === providerId);
  return preset?.label ?? providerId ?? "";
}

/** The mailbox section of a profile page: what is connected, or the way to connect one. */
export function MailboxCard({
  profile,
}: {
  profile: Pick<ProfileSummary, "id"> & { mailbox: Mailbox | null };
}) {
  const label = useProviderLabel(profile.mailbox?.provider);
  const { mailbox } = profile;
  const manage = paths.mailbox(profile.id);

  if (!mailbox) {
    return (
      <Section label="Mailbox">
        <EmptyState
          title="No mailbox connected."
          description="Requests go out from this person's own email account, and replies are read from it."
          actions={
            <LinkButton to={manage} variant="primary">
              Connect a mailbox
            </LinkButton>
          }
        />
      </Section>
    );
  }

  return (
    <Section
      label="Mailbox"
      actions={
        <LinkButton to={manage} size="sm">
          Manage mailbox
        </LinkButton>
      }
    >
      {mailbox.lastError ? (
        <Callout intent="warning" title="The last check failed" className="mb-3">
          {mailbox.lastError}
        </Callout>
      ) : null}
      <SendPauseAlert mailbox={mailbox} />
      <MailboxFacts mailbox={mailbox} providerLabel={label} />
    </Section>
  );
}
