import { API_ROUTES, type Mailbox, type ProfileSummary } from "@kickrocks/shared";
import { useApiQuery } from "../../api/index.js";
import { Alert, Card, CardHeader, DescriptionList, LinkButton } from "../../components/ui/index.js";
import { formatRelative } from "../../lib/format.js";

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
    <DescriptionList
      items={[
        ...(hideAddress
          ? []
          : [
              {
                term: "Address",
                description: <span className="break-all">{mailbox.address}</span>,
              },
            ]),
        { term: "Provider", description: providerLabel },
        {
          term: "Sending server",
          description: `${mailbox.smtpHost}:${mailbox.smtpPort}`,
        },
        {
          term: "Receiving server",
          description: `${mailbox.imapHost}:${mailbox.imapPort}`,
        },
        { term: "Reply folder", description: mailbox.replyFolder },
        { term: "Daily limit", description: `${mailbox.dailyCap} requests a day` },
        {
          term: "Last checked",
          description: mailbox.lastPolledAt
            ? formatRelative(mailbox.lastPolledAt)
            : "Not checked yet",
        },
      ]}
    />
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
      <Card>
        <CardHeader
          title="Mailbox"
          description="Requests are sent from this person's own email account, and replies are read from it."
        />
        <LinkButton to={manage} variant="primary">
          Connect a mailbox
        </LinkButton>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Mailbox" actions={<LinkButton to={manage}>Manage mailbox</LinkButton>} />
      {mailbox.lastError ? (
        <Alert intent="warning" title="The last check failed" className="mb-4">
          {mailbox.lastError}
        </Alert>
      ) : null}
      <MailboxFacts mailbox={mailbox} providerLabel={label} />
    </Card>
  );
}
