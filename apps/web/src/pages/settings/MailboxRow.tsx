import { API_ROUTES } from "@kickrocks/shared";
import { useApiQuery, useCurrentProfile } from "../../api/index.js";
import { LinkButton, Row, RowGroup, Section } from "../../components/ui/index.js";
import { paths } from "../../lib/paths.js";
import { MailboxStateLine } from "../mailbox/mailbox-card.js";

/** Each profile has its own mailbox, so this row is the way to it from the settings page. */
export function MailboxRow() {
  const { profile, isLoading } = useCurrentProfile();
  const detail = useApiQuery(API_ROUTES.profilesGet, {
    params: { id: profile?.id ?? "" },
    enabled: Boolean(profile?.mailboxConnected),
  });
  const mailbox = detail.data?.mailbox ?? null;

  if (isLoading) return null;

  if (profile?.mailboxConnected) {
    return (
      <Section label="Mailbox">
        <RowGroup>
          <Row
            wrapTitle
            title={mailbox ? <MailboxStateLine mailbox={mailbox} checked="checked" /> : "Connected"}
            trailing={<LinkButton to={`${paths.mailbox(profile.id)}#intake`}>Open</LinkButton>}
          />
        </RowGroup>
      </Section>
    );
  }

  return (
    <Section label="Mailbox">
      <RowGroup>
        <Row
          title="Not connected"
          trailing={
            <LinkButton
              variant="primary"
              to={profile ? paths.mailbox(profile.id) : "/profiles/new"}
            >
              Connect
            </LinkButton>
          }
        />
      </RowGroup>
    </Section>
  );
}
