import { API_ROUTES, type ProfileField, type VerificationItem } from "@kickrocks/shared";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Button, Card, Checkbox, useToast } from "../../components/ui/index.js";
import { formatRelative } from "../../lib/format.js";
import { PROFILE_FIELD_LABELS } from "../../lib/labels.js";
import { REVIEW_INVALIDATES } from "./model.js";

/** What a broker asked for beyond what was already sent. Nothing is ticked, so nothing goes out by default. */
export function VerificationCard({ item }: { item: VerificationItem }) {
  const toast = useToast();
  const [approved, setApproved] = useState<ReadonlySet<ProfileField>>(new Set());
  const { request, message } = item;

  const send = useApiMutation(API_ROUTES.requestsVerification, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: () => toast.success("Sending the details you approved"),
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });

  const toggle = (field: ProfileField, on: boolean) =>
    setApproved((current) => {
      const next = new Set(current);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });

  const fields = item.requestedFields.filter((field) => approved.has(field));

  return (
    <Card aria-label={`${request.target.name} asked for more details`}>
      <h3 className="break-words text-lg font-semibold text-ink">{request.target.name}</h3>
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
            {item.requestedFields.map((field) => (
              <Checkbox
                key={field}
                label={PROFILE_FIELD_LABELS[field]}
                checked={approved.has(field)}
                onChange={(event) => toggle(field, event.target.checked)}
              />
            ))}
          </div>
        )}
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={fields.length === 0}
          loading={send.isPending}
          onClick={() =>
            send.mutate({
              params: { id: request.id },
              body: { messageId: message.id, fields },
            })
          }
        >
          Send selected details
        </Button>
        {fields.length === 0 && item.requestedFields.length > 0 ? (
          <span className="text-sm text-ink-muted">Tick at least one detail to send.</span>
        ) : null}
      </div>
    </Card>
  );
}
