import { useCurrentProfile } from "../../api/index.js";
import { LinkButton, RowGroup, Section } from "../../components/ui/index.js";
import { CleanupPreview, IgnoredMail } from "../mailbox/intake-review.js";
import { ActionRow } from "./rows.js";

/** Each profile has its own mailbox, so this row is the way to it from the settings page. */
export function MailIntakeCard() {
  const { profile } = useCurrentProfile();
  if (!profile) return null;
  const mailbox = `/profiles/${profile.id}/mailbox`;

  return (
    <>
      <Section label="Mailbox">
        <RowGroup>
          <ActionRow
            title="Mailbox"
            description={
              profile.mailboxConnected
                ? "Which mail is kept, and the reply address"
                : "Not connected"
            }
          >
            <LinkButton to={profile.mailboxConnected ? `${mailbox}#intake` : mailbox}>
              {profile.mailboxConnected ? "Open" : "Connect a mailbox"}
            </LinkButton>
          </ActionRow>
        </RowGroup>
      </Section>
      {profile.mailboxConnected ? (
        <>
          <CleanupPreview profileId={profile.id} />
          <IgnoredMail profileId={profile.id} />
        </>
      ) : null}
    </>
  );
}
