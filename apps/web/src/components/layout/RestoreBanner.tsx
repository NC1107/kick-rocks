import { API_ROUTES } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import { formatRelative } from "../../lib/format.js";
import { Button, Callout, ConfirmDialog } from "../ui/index.js";

const CHECKING_REFRESH_MS = 15_000;
const IDLE_REFRESH_MS = 120_000;

/**
 * Shown while the server holds every send after a restore. A restored database does not know about
 * mail sent after its backup, so the server first looks in each mailbox's Sent folder, and only a
 * person who has looked for themselves can tell it to go on when that check cannot finish.
 */
export function RestoreBanner() {
  const [confirming, setConfirming] = useState(false);
  const state = useApiQuery(API_ROUTES.restoreState, {
    refetchInterval: (data) => (data?.holding ? CHECKING_REFRESH_MS : IDLE_REFRESH_MS),
  });
  const resume = useApiMutation(API_ROUTES.restoreResume, {
    invalidates: [API_ROUTES.restoreState],
    onSuccess: () => setConfirming(false),
  });

  const held = state.data;
  if (!held?.holding) return null;
  const since = held.restoredAt ? ` Restored ${formatRelative(held.restoredAt)}.` : "";

  return (
    <>
      <Callout
        intent={held.problem ? "danger" : "warning"}
        title="Sending is paused after the restore"
        className="mb-4"
        action={
          held.problem ? (
            <Button size="sm" onClick={() => setConfirming(true)}>
              Resume sending
            </Button>
          ) : undefined
        }
      >
        {held.problem ? (
          <>
            The Sent folder could not be checked: {held.problem}. The restored data does not know
            about mail sent after the backup, so resuming can email a broker a second time.
          </>
        ) : (
          <>
            Checking each mailbox's Sent folder for mail that went out after the backup, so no
            broker is emailed twice. Sending resumes by itself when that is done.
          </>
        )}
        {since}
      </Callout>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Resume sending?"
        description="Look in your Sent folder first. Requests that already went out will be emailed again."
        confirmLabel="Resume sending"
        onConfirm={() => resume.mutate({ body: { confirm: true } })}
        loading={resume.isPending}
      >
        {resume.error ? <p className="text-danger-text">{errorMessage(resume.error)}</p> : null}
      </ConfirmDialog>
    </>
  );
}
