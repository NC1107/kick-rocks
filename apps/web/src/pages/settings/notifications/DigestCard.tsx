import { API_ROUTES, type DigestFrequency, type NotificationsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Field,
  Select,
  useToast,
} from "../../../components/ui/index.js";
import { formatDateTime, formatRelative } from "../../../lib/format.js";
import { formatHourUtc, HOURS, WEEKDAYS } from "./model.js";

type Digest = NotificationsView["digest"];

const OUTCOME_TEXT = {
  sent: "Digest sent to your mailbox.",
  nothing_to_report: "Nothing changed and nothing needs you, so no digest was sent.",
  no_mailbox: "Connect a mailbox first.",
  failed: "The digest could not be sent.",
} as const;

export function DigestCard({
  digest,
  mailboxReady,
  status,
}: Pick<NotificationsView, "digest" | "mailboxReady" | "status">) {
  const toast = useToast();
  const [draft, setDraft] = useState<Digest>(digest);
  const [notice, setNotice] = useState<{ intent: "success" | "warning"; text: string } | null>(
    null,
  );

  useEffect(() => setDraft(digest), [digest]);

  const save = useApiMutation(API_ROUTES.notificationsPatch, {
    invalidates: [API_ROUTES.notificationsGet],
    onSuccess: () => toast.success("Digest saved"),
  });
  const sendNow = useApiMutation(API_ROUTES.notificationsDigestSend, {
    invalidates: [API_ROUTES.notificationsGet],
    onSuccess: (result) => {
      const text = result.error
        ? `${OUTCOME_TEXT[result.outcome]} ${result.error}`
        : OUTCOME_TEXT[result.outcome];
      setNotice({ intent: result.outcome === "sent" ? "success" : "warning", text });
    },
    onError: (error) => setNotice({ intent: "warning", text: errorMessage(error) }),
  });

  const dirty =
    draft.frequency !== digest.frequency ||
    draft.hourUtc !== digest.hourUtc ||
    draft.weekday !== digest.weekday;

  return (
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ body: { digest: draft } });
        }}
      >
        <CardHeader
          title="Digest email"
          description="A summary of status changes and what needs you, mailed from your own mailbox to itself. Nothing goes through another service."
        />
        {mailboxReady ? null : (
          <div className="mb-4">
            <Alert intent="warning" title="No mailbox yet">
              The digest is sent from your mailbox. Connect one on your profile first.
            </Alert>
          </div>
        )}
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          <Field label="How often">
            <Select
              value={draft.frequency}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  frequency: event.target.value as DigestFrequency,
                }))
              }
            >
              <option value="off">Never</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </Select>
          </Field>
          <Field label="On">
            <Select
              disabled={draft.frequency !== "weekly"}
              value={draft.weekday}
              onChange={(event) =>
                setDraft((current) => ({ ...current, weekday: Number(event.target.value) }))
              }
            >
              {WEEKDAYS.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="At">
            <Select
              disabled={draft.frequency === "off"}
              value={draft.hourUtc}
              onChange={(event) =>
                setDraft((current) => ({ ...current, hourUtc: Number(event.target.value) }))
              }
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {formatHourUtc(hour)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {status.digestLastSentAt ? (
          <p className="mt-4 text-sm text-ink-muted">
            Last digest covered up to{" "}
            <time
              dateTime={status.digestLastSentAt}
              title={formatDateTime(status.digestLastSentAt)}
            >
              {formatRelative(status.digestLastSentAt)}
            </time>
            .
          </p>
        ) : null}
        {status.digestLastError ? (
          <div className="mt-4">
            <Alert intent="danger" title="The last digest failed">
              {status.digestLastError}
            </Alert>
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4">
            <Alert intent={notice.intent}>{notice.text}</Alert>
          </div>
        ) : null}
        {save.isError ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save the digest">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        <CardFooter>
          <Button
            loading={sendNow.isPending}
            disabled={!mailboxReady || dirty}
            onClick={() => {
              setNotice(null);
              sendNow.mutate();
            }}
          >
            Send one now
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save digest
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
