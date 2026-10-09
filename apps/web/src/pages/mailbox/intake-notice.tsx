import { API_ROUTES, type Mailbox } from "@kickrocks/shared";
import { useApiMutation } from "../../api/index.js";
import { Button, Callout, LinkButton } from "../../components/ui/index.js";

/**
 * Tells the person once that Kick Rocks now keeps only mail about their requests, and how many
 * saved messages the one-time cleanup removed. Dismissing it is remembered by the server.
 */
export function IntakeNotice({
  profileId,
  mailbox,
  className,
}: {
  profileId: string;
  mailbox: Pick<Mailbox, "intakeNotice"> | null | undefined;
  className?: string;
}) {
  const dismiss = useApiMutation(API_ROUTES.mailboxNoticeDismiss, {
    invalidates: [API_ROUTES.profilesGet],
  });
  const notice = mailbox?.intakeNotice;
  if (!notice) return null;

  return (
    <Callout
      title="Kick Rocks now keeps only mail about your requests"
      {...(className ? { className } : {})}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton size="sm" to={`/profiles/${profileId}/mailbox#intake`}>
            See what Kick Rocks takes in
          </LinkButton>
          <Button
            size="sm"
            variant="ghost"
            loading={dismiss.isPending}
            onClick={() => dismiss.mutate({ params: { id: profileId } })}
          >
            Dismiss
          </Button>
        </div>
      }
    >
      It removed {notice.removed} messages it had saved, such as store offers, order updates and
      bank alerts. They are still in your mailbox: Kick Rocks only deleted its own copy. Mail you
      acted on, and every reply that changed a request, was kept.
    </Callout>
  );
}
