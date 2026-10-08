import { API_ROUTES, type Mailbox, type ProfileSummary } from "@kickrocks/shared";
import { useApiQuery } from "../../api/index.js";
import {
  Callout,
  EmptyState,
  LinkButton,
  RelativeTime,
  RowGroup,
  Section,
} from "../../components/ui/index.js";
import { FactRow } from "../settings/rows.js";

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

/** The facts of a saved mailbox. The password is never among them: the server does not send it. */
export function MailboxFacts({
  mailbox,
  providerLabel,
  hideAddress = false,
}: {
  mailbox: Mailbox;
  providerLabel: string;
  /** Leave the address out when a heading above already names it. */
  hideAddress?: boolean;
}) {
  return (
    <RowGroup>
      {hideAddress ? null : <FactRow label="Address">{mailbox.address}</FactRow>}
      <FactRow label="Provider" mono={false}>
        {providerLabel}
      </FactRow>
      <FactRow label="Sending server">{`${mailbox.smtpHost}:${mailbox.smtpPort}`}</FactRow>
      <FactRow label="Receiving server">{`${mailbox.imapHost}:${mailbox.imapPort}`}</FactRow>
      <FactRow label="Reply folder">{mailbox.replyFolder}</FactRow>
      <FactRow label="Daily limit">{`${mailbox.dailyCap} requests a day`}</FactRow>
      <FactRow label="Last checked" mono={Boolean(mailbox.lastPolledAt)}>
        {mailbox.lastPolledAt ? <RelativeTime iso={mailbox.lastPolledAt} /> : "Not checked yet"}
      </FactRow>
    </RowGroup>
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
  const manage = `/profiles/${profile.id}/mailbox`;

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
