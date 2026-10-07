import {
  API_ROUTES,
  type ProfileField,
  resolveProfileFields,
  type VerificationItem,
} from "@kickrocks/shared";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  useToast,
} from "../../components/ui/index.js";
import { formatRelative } from "../../lib/format.js";
import { PROFILE_FIELD_LABELS } from "../../lib/labels.js";
import { REVIEW_INVALIDATES } from "./model.js";

/** What a broker asked for beyond what was already sent. Nothing is ticked, so nothing goes out by default. */
export function VerificationCard({ item }: { item: VerificationItem }) {
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
    onSuccess: () => {
      setConfirming(null);
      toast.success("Sending the details you approved");
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
  const missing = values ? item.requestedFields.filter((field) => values[field] === undefined) : [];

  return (
    <Card aria-label={`${request.target.name} asked for more details`}>
      <h2 className="break-words text-lg font-semibold text-ink">{request.target.name}</h2>
      <p className="text-sm text-ink-muted">
        Request{" "}
        <Link
          to={`/requests/${encodeURIComponent(request.id)}`}
          className="rounded-xs font-mono text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {request.reference}
        </Link>
        , they replied{" "}
        <time dateTime={message.receivedAt}>{formatRelative(message.receivedAt)}</time>
      </p>

      {message.snippet ? (
        <blockquote className="m-0 mt-3 border-l-2 border-line-strong pl-3 text-base text-ink">
          {message.snippet}
        </blockquote>
      ) : null}

      <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-medium text-ink">They asked for</legend>
        <p className="mb-3 text-sm text-ink-muted">
          Tick only what you are willing to send. Anything you leave unticked stays private.
        </p>
        {item.requestedFields.length === 0 ? (
          <p className="text-base text-ink-muted">
            The message did not name a specific detail. Open the request to read it.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {item.requestedFields.map((field) => {
              const value = values?.[field];
              return value === undefined ? null : (
                <Checkbox
                  key={field}
                  label={PROFILE_FIELD_LABELS[field]}
                  description={value}
                  checked={approved.has(field)}
                  onChange={(event) => toggle(field, event.target.checked)}
                />
              );
            })}
            {missing.map((field) => (
              <p key={field} className="m-0 text-sm text-ink-muted">
                <span className="font-medium text-ink">{PROFILE_FIELD_LABELS[field]}</span> is not
                on the profile.{" "}
                <Link to={profileLink} className="text-accent underline underline-offset-2">
                  Add a {PROFILE_FIELD_LABELS[field].toLowerCase()} to send it
                </Link>
                .
              </p>
            ))}
          </div>
        )}
      </fieldset>

      {send.isError ? (
        <div className="mt-4">
          <Alert intent="danger" title="Could not send the details">
            {errorMessage(send.error)}
          </Alert>
        </div>
      ) : null}
      {decline.isError ? (
        <div className="mt-4">
          <Alert intent="danger" title="Could not cancel the request">
            {errorMessage(decline.error)}
          </Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
          <span className="text-sm text-ink-muted">Tick at least one detail to send.</span>
        ) : null}
      </div>

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
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
          {fields.map((field) => (
            <div key={field} className="contents">
              <dt className="text-ink-muted">{PROFILE_FIELD_LABELS[field]}</dt>
              <dd className="m-0 min-w-0 break-words text-ink">{values?.[field]}</dd>
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
    </Card>
  );
}
