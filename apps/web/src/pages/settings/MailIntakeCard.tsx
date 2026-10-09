import { useCurrentProfile } from "../../api/index.js";
import { LinkButton, RowGroup, Section } from "../../components/ui/index.js";
import { ActionRow } from "./rows.js";

/**
 * Mail intake lives with the mailbox, because each profile has its own. This row is the way to it
 * from the settings page, where a person looks first.
 */
export function MailIntakeCard() {
  const { profile } = useCurrentProfile();
  if (!profile) return null;
  const mailbox = `/profiles/${profile.id}/mailbox`;

  return (
    <Section label="Mail">
      <RowGroup>
        <ActionRow
          title="What Kick Rocks takes in"
          description={
            profile.mailboxConnected
              ? "Which mail from your inbox Kick Rocks keeps, the reply address, and a way to find a reply it missed."
              : "Connect a mailbox first. Kick Rocks keeps only mail about your requests and, if you choose, other mail from those companies."
          }
        >
          <LinkButton to={profile.mailboxConnected ? `${mailbox}#intake` : mailbox}>
            {profile.mailboxConnected ? "Open" : "Connect a mailbox"}
          </LinkButton>
        </ActionRow>
      </RowGroup>
    </Section>
  );
}
