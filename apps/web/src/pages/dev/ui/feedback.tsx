import { RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Skeleton,
  SkeletonText,
  Spinner,
  useToast,
} from "../../../components/ui/index.js";
import { Section, Specimen } from "./parts.js";

export function Feedback() {
  const toast = useToast();
  const [dialog, setDialog] = useState<"plain" | "confirm" | "destroy" | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => setDialog(null);

  return (
    <>
      <Section
        title="Alerts and toasts"
        description="An alert stays in the page. A toast confirms something that already happened and names it with the verb of the button that caused it."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Alert intent="info" title="Mailbox checked a few minutes ago">
            Replies are read every 15 minutes.
          </Alert>
          <Alert intent="success" title="Connected">
            Sent a test message and read the inbox.
          </Alert>
          <Alert
            intent="warning"
            title="Daily cap nearly reached"
            action={<Button size="sm">Raise cap</Button>}
          >
            140 of 150 messages sent in the last 24 hours.
          </Alert>
          <Alert
            intent="danger"
            title="Could not load requests"
            action={
              <Button size="sm">
                <RefreshCw aria-hidden="true" className="size-3.5" />
                Try again
              </Button>
            }
          >
            Could not reach the server. Check that Kick Rocks is running, then try again.
          </Alert>
        </div>
        <Specimen label="Toasts">
          <Button onClick={() => toast.success("Request cancelled")}>Success</Button>
          <Button
            onClick={() => toast.info("Checking the inbox", "New replies show up in Review.")}
          >
            Info
          </Button>
          <Button
            onClick={() => toast.toast({ intent: "warning", title: "Mailbox is close to its cap" })}
          >
            Warning
          </Button>
          <Button
            onClick={() => toast.error("Could not send", "The mail server refused the password.")}
          >
            Error
          </Button>
        </Specimen>
      </Section>

      <Section
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
          description="Brokers match on the address they hold, so use the one on file with them."
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
      </Section>

      <Section
        title="Loading"
        description="Skeletons hold the shape of what is coming. A spinner is for a short wait with no shape."
      >
        <div className="flex flex-wrap items-center gap-6">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </div>
        <div className="grid max-w-xl gap-3 rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-5 w-40" />
          <SkeletonText lines={3} />
        </div>
      </Section>
    </>
  );
}
