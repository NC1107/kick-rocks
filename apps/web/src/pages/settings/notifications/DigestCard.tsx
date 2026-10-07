import { API_ROUTES, type DigestFrequency, type NotificationsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  Callout,
  RowGroup,
  Section,
  Select,
  Tooltip,
  useToast,
} from "../../../components/ui/index.js";
import { formatDateTime, formatRelative } from "../../../lib/format.js";
import { FieldRow, GroupFooter, GroupNote } from "../rows.js";
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
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ body: { digest: draft } });
      }}
    >
      <Section label="Digest email">
        {mailboxReady ? null : (
          <Callout intent="warning" title="No mailbox yet" className="mb-3">
            The digest is sent from your mailbox. Connect one on your profile first.
          </Callout>
        )}
        <RowGroup>
          <FieldRow label="How often">
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
          </FieldRow>
          <FieldRow label="On">
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
          </FieldRow>
          <FieldRow label="At">
            <Select
              mono
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
          </FieldRow>
          <GroupFooter>
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
          </GroupFooter>
        </RowGroup>
        <GroupNote>
          Mailed from your own mailbox to itself. Nothing goes through another service.
        </GroupNote>
        {status.digestLastSentAt ? (
          <GroupNote>
            Last digest covered up to{" "}
            <Tooltip content={formatDateTime(status.digestLastSentAt)}>
              <time dateTime={status.digestLastSentAt}>
                {formatRelative(status.digestLastSentAt)}
              </time>
            </Tooltip>
            .
          </GroupNote>
        ) : null}
        {status.digestLastError ? (
          <Callout intent="danger" title="The last digest failed" className="mt-3">
            {status.digestLastError}
          </Callout>
        ) : null}
        {notice ? (
          <Callout intent={notice.intent} className="mt-3">
            {notice.text}
          </Callout>
        ) : null}
        {save.isError ? (
          <Callout intent="danger" title="Could not save the digest" className="mt-3">
            {errorMessage(save.error)}
          </Callout>
        ) : null}
      </Section>
    </form>
  );
}
