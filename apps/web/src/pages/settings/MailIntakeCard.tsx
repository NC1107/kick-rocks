import { useCurrentProfile } from "../../api/index.js";
import { LinkButton, RowGroup, Section } from "../../components/ui/index.js";
import { CleanupPreview, IgnoredMail } from "../mailbox/intake-review.js";
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
    <>
      <Section label="Mail">
        <RowGroup>
          <ActionRow
            title="What is taken in"
            description={
              profile.mailboxConnected
                ? "Which mail is kept, the reply address, and a missed-reply search."
                : "Connect a mailbox to keep mail about your requests."
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
