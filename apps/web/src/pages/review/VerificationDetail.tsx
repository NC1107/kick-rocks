import {
  API_ROUTES,
  type ProfileField,
  resolveProfileFields,
  type VerificationItem,
} from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  RowGroup,
  Section,
  TextLink,
  useToast,
} from "../../components/ui/index.js";
import { formatRelative } from "../../lib/format.js";
import { PROFILE_FIELD_LABELS } from "../../lib/labels.js";
import { DetailFrame } from "./DetailFrame.js";
import { REVIEW_INVALIDATES } from "./model.js";

/** What a broker asked for beyond what was already sent. Nothing is ticked, so nothing goes out by default. */
export function VerificationDetail({ item }: { item: VerificationItem }) {
  const toast = useToast();
  const [approved, setApproved] = useState<ReadonlySet<ProfileField>>(new Set());
  const [confirming, setConfirming] = useState<"send" | "decline" | null>(null);
  const { request, message } = item;
  const profile = useApiQuery(API_ROUTES.profilesGet, { params: { id: request.profileId } });
  const values = profile.data
    ? resolveProfileFields(profile.data.identities, item.requestedFields, {
        asOf: new Date().toISOString().slice(0, 10),
      })
    : null;
  const profileLink = `/profiles/${encodeURIComponent(request.profileId)}`;

  const send = useApiMutation(API_ROUTES.requestsVerification, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: (_result, variables) => {
      setConfirming(null);
      const sent = variables.body.fields.map((field) => PROFILE_FIELD_LABELS[field].toLowerCase());
      toast.success(`Sending ${sent.join(", ")} to ${request.target.name}`);
    },
    onError: () => setConfirming(null),
  });
  const decline = useApiMutation(API_ROUTES.requestsAct, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: () => {
      setConfirming(null);
      toast.success("Request cancelled", "Nothing was sent to them.");
    },
    onError: () => setConfirming(null),
  });

  const toggle = (field: ProfileField, on: boolean) =>
    setApproved((current) => {
      const next = new Set(current);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });

  const fields = item.requestedFields.filter(
    (field) => approved.has(field) && values?.[field] !== undefined,
  );

  const footer = (
    <>
      <Button
        variant="primary"
        disabled={fields.length === 0}
        onClick={() => setConfirming("send")}
      >
        Send selected details
      </Button>
      <Button variant="secondary" onClick={() => setConfirming("decline")}>
        Send nothing and cancel
      </Button>
      {fields.length === 0 && item.requestedFields.length > 0 ? (
        <span className="text-meta text-ink-3">Tick at least one detail to send.</span>
      ) : null}
    </>
  );

  return (
    <>
      <DetailFrame
        label={`${request.target.name} asked for more details`}
        title={request.target.name}
        meta={
          <>
            Request{" "}
            <TextLink to={`/requests/${encodeURIComponent(request.id)}`} className="font-mono">
              {request.reference}
            </TextLink>
            , they replied{" "}
            <time dateTime={message.receivedAt}>{formatRelative(message.receivedAt)}</time>
          </>
        }
        footer={footer}
      >
        {message.snippet ? (
          <blockquote className="m-0 border-l-2 border-line-strong pl-3 text-body text-ink">
            {message.snippet}
          </blockquote>
        ) : null}

        <Section label="They asked for" as="h3">
          {item.requestedFields.length === 0 ? (
            <p className="text-ui text-ink-2">
              The message did not name a specific detail. Open the request to read it.
            </p>
          ) : (
            <RowGroup>
              {item.requestedFields.map((field) => {
                const value = values?.[field];
                return value === undefined ? (
                  values ? (
                    <p key={field} className="m-0 px-3.5 py-2.5 text-meta text-ink-3">
                      <span className="font-medium text-ink">{PROFILE_FIELD_LABELS[field]}</span> is
                      not on the profile.{" "}
                      <TextLink to={profileLink}>
                        Add a {PROFILE_FIELD_LABELS[field].toLowerCase()} to send it
                      </TextLink>
                      .
                    </p>
                  ) : null
                ) : (
                  <Checkbox
                    key={field}
                    label={PROFILE_FIELD_LABELS[field]}
                    description={<span className="font-mono">{value}</span>}
                    checked={approved.has(field)}
                    onChange={(event) => toggle(field, event.target.checked)}
                    className="px-3.5 py-2.5"
                  />
                );
              })}
            </RowGroup>
          )}
          <p className="mt-1.5 text-caption text-ink-3">Unticked details stay private.</p>
        </Section>

        {send.isError ? (
          <Alert intent="danger" title="Could not send the details">
            {errorMessage(send.error)}
          </Alert>
        ) : null}
        {decline.isError ? (
          <Alert intent="danger" title="Could not cancel the request">
            {errorMessage(decline.error)}
          </Alert>
        ) : null}
      </DetailFrame>

      <ConfirmDialog
        open={confirming === "send"}
        onClose={() => setConfirming(null)}
        title={`Send these details to ${request.target.name}?`}
        description="They go out by email from your mailbox, exactly as listed. Anything not listed stays private."
        confirmLabel="Send details"
        loading={send.isPending}
        onConfirm={() =>
          send.mutate({ params: { id: request.id }, body: { messageId: message.id, fields } })
        }
      >
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui">
          {fields.map((field) => (
            <div key={field} className="contents">
              <dt className="text-ink-3">{PROFILE_FIELD_LABELS[field]}</dt>
              <dd className="m-0 min-w-0 break-words font-mono text-ink">{values?.[field]}</dd>
            </div>
          ))}
        </dl>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "decline"}
        onClose={() => setConfirming(null)}
        title={`Cancel the request to ${request.target.name}?`}
        description="Nothing more is sent to them. Nothing already sent is recalled. To keep the request waiting instead, leave this card as it is."
        confirmLabel="Cancel request"
        destructive
        loading={decline.isPending}
        onConfirm={() => decline.mutate({ params: { id: request.id }, body: { action: "cancel" } })}
      />
    </>
  );
}
