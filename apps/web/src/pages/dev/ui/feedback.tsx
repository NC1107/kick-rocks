import { useState } from "react";
import {
  Button,
  Callout,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Hatch,
  Input,
  Meter,
  Skeleton,
  SkeletonText,
  Spinner,
  TextLink,
  useToast,
} from "../../../components/ui/index.js";
import { Panel, Specimen } from "./parts.js";

export function Feedback() {
  const toast = useToast();
  const [dialog, setDialog] = useState<"plain" | "confirm" | "destroy" | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => setDialog(null);

  return (
    <>
      <Panel
        title="Callouts and toasts"
        description="A callout is a 1px edge in its tone on the surface and stays in the page. A toast confirms something the person just did and names it with the verb of the button that caused it."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Callout intent="info" title="Inbox checked 7 minutes ago">
            Replies are read every minute.
          </Callout>
          <Callout intent="success" title="Connected">
            Sent a test message and read the inbox.
          </Callout>
          <Callout
            intent="warning"
            title="Daily limit nearly reached"
            action={<Button size="sm">Raise limit</Button>}
          >
            140 of 150 messages sent in the last 24 hours.
          </Callout>
          <Callout
            intent="danger"
            title="Could not load requests"
            action={<Button size="sm">Try again</Button>}
          >
            Could not reach the server.
          </Callout>
          <Callout intent="warning">The worker has not answered in 12 minutes.</Callout>
          <Callout intent="danger">The mail server refused the password.</Callout>
        </div>
        <Specimen label="Toasts: confirmations only">
          <Button onClick={() => toast.success("Cancelled the request")}>Success</Button>
          <Button onClick={() => toast.info("Checked the inbox", "New replies show up in Review.")}>
            Neutral
          </Button>
          <Button
            onClick={() =>
              toast.toast({ intent: "warning", title: "Mailbox is close to its limit" })
            }
          >
            Attention
          </Button>
          <Button
            onClick={() => toast.error("Could not send", "The mail server refused the password.")}
          >
            Danger
          </Button>
        </Specimen>
      </Panel>

      <Panel
        title="Dialogs"
        description="The native modal element: focus is trapped, Escape closes it, and focus returns to the button that opened it."
      >
        <Specimen label="Open one, then press Tab and Escape">
          <Button onClick={() => setDialog("plain")}>Edit address</Button>
          <Button onClick={() => setDialog("confirm")}>Send 24 requests</Button>
          <Button variant="danger" onClick={() => setDialog("destroy")}>
            Delete profile
          </Button>
        </Specimen>
        <Dialog
          open={dialog === "plain"}
          onClose={close}
          title="Edit address"
          description="Targets match on the address they hold."
          footer={
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={close}>
                Save
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Street">
              <Input defaultValue="100 Example Street" />
            </Field>
            <Field label="City">
              <Input defaultValue="Sampleton" />
            </Field>
          </div>
        </Dialog>
        <ConfirmDialog
          open={dialog === "confirm"}
          onClose={close}
          title="Send 24 requests?"
          description="Each goes from jordan@example.com, paced through the day."
          confirmLabel="Send requests"
          loading={busy}
          onConfirm={() => {
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              close();
              toast.success("Queued 24 requests");
            }, 900);
          }}
        />
        <ConfirmDialog
          open={dialog === "destroy"}
          onClose={close}
          title="Delete Jordan Example?"
          description="This removes the profile, its mailbox connection, and every request. It cannot be undone."
          confirmLabel="Delete profile"
          destructive
          onConfirm={close}
        />
      </Panel>

      <Panel
        title="Meter"
        description="A 6px track with a mono readout and ticks at 50% and 80%. The fill turns to attention past the warning line."
      >
        <div className="grid max-w-xl gap-4">
          <Meter label="Sent today" value={0} max={150} readout="0 of 150" />
          <Meter label="Sent today" value={42} max={150} readout="42 of 150" />
          <Meter label="Sent today" value={96} max={150} readout="96 of 150" />
          <Meter label="Sent today" value={141} max={150} readout="141 of 150" />
          <Meter label="Reply window" value={34} max={45} readout="due in 11 d" />
        </div>
      </Panel>

      <Panel
        title="Empty, loading, hatch"
        description="An empty state is one sentence where the content would be. Skeletons keep the shape of what is coming. Hatching stands in for missing imagery."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <EmptyState title="Nothing needs you." />
          <EmptyState
            title="No requests yet."
            actions={
              <TextLink to="/campaigns/new" className="text-ui">
                Start a campaign
              </TextLink>
            }
          />
          <EmptyState
            title="No targets match these filters."
            actions={<Button size="sm">Clear filters</Button>}
          />
          <EmptyState
            title="Could not load the queue."
            description="Check that Kick Rocks is running."
            actions={<Button size="sm">Try again</Button>}
          />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </div>
        <div className="grid max-w-xl gap-3 rounded-md border border-line bg-surface p-4">
          <Skeleton className="h-5 w-40" />
          <SkeletonText lines={3} />
        </div>
        <Specimen label="Hatch: a screenshot that was not captured">
          <Hatch className="h-28 w-56">No screenshot</Hatch>
          <Hatch className="size-12 text-label" aria-label="No logo" />
        </Specimen>
      </Panel>
    </>
  );
}
