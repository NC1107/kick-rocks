import { API_ROUTES, ReplyClassification, type ReviewMessage } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  ExternalLinkText,
  Field,
  Select,
  SkeletonText,
  useToast,
} from "../../components/ui/index.js";
import { formatDateTime } from "../../lib/format.js";
import { CLASSIFICATION_LABELS } from "../../lib/labels.js";
import { REVIEW_INVALIDATES } from "./model.js";

function FullText({ messageId }: { messageId: string }) {
  const query = useApiQuery(API_ROUTES.messageGet, { params: { id: messageId } });
  if (query.isPending) return <SkeletonText lines={4} />;
  if (query.isError) {
    return (
      <Alert intent="danger" title="Could not load the message">
        {errorMessage(query.error)}
      </Alert>
    );
  }
  return (
    <pre className="m-0 whitespace-pre-wrap break-words rounded-md bg-sunken p-3 font-sans text-base text-ink">
      {query.data.text ?? "This message has no text."}
    </pre>
  );
}

/** Mail nobody could classify. The person says what it is, and may attach it to a request. */
export function MessageCard({ message, profileId }: { message: ReviewMessage; profileId: string }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [classification, setClassification] = useState<ReplyClassification | "">("");
  const [requestId, setRequestId] = useState("");

  const needsRequest = message.requestId === null;
  const requests = useApiQuery(
    API_ROUTES.requestsList,
    needsRequest
      ? { params: { id: profileId }, query: { pageSize: 200 }, staleTime: 30_000 }
      : skipToken,
  );

  const classify = useApiMutation(API_ROUTES.messageClassify, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: () => toast.success("Message classified"),
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });

  return (
    <Card aria-label={message.subject}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold text-ink">{message.subject}</h3>
          <p className="break-words text-sm text-ink-muted">
            From {message.fromAddress},{" "}
            <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
          </p>
        </div>
        <Badge tone="amber">{Math.round(message.confidence * 100)}% sure</Badge>
      </div>

      {message.requestReference ? (
        <p className="mt-2 text-sm text-ink-muted">
          Matched to request <span className="font-mono">{message.requestReference}</span>
          {message.targetName ? ` for ${message.targetName}` : ""}
        </p>
      ) : null}

      {message.rationale ? (
        <p className="mt-2 text-sm text-ink-muted">{message.rationale}</p>
      ) : null}

      <div className="mt-3">
        {expanded ? (
          <FullText messageId={message.id} />
        ) : message.snippet ? (
          <p className="break-words text-base text-ink">{message.snippet}</p>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 -ml-2.5"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Read the whole message"}
        </Button>
      </div>

      {message.links.length > 0 ? (
        <ul className="m-0 mt-2 list-none p-0">
          {message.links.map((link) => (
            <li key={link} className="text-sm">
              <ExternalLinkText href={link} className="break-all">
                {link}
              </ExternalLinkText>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!classification) return;
          classify.mutate({
            params: { id: message.id },
            body: { classification, ...(requestId ? { requestId } : {}) },
          });
        }}
      >
        <Field label="What is this message">
          <Select
            value={classification}
            onChange={(event) => setClassification(event.target.value as ReplyClassification)}
          >
            <option value="">Choose one</option>
            {ReplyClassification.options.map((option) => (
              <option key={option} value={option}>
                {CLASSIFICATION_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
        {needsRequest ? (
          <Field
            label="Which request is it about"
            optional
            help={
              requests.isError
                ? "The request list did not load. You can still classify it."
                : undefined
            }
          >
            <Select
              value={requestId}
              disabled={requests.isPending}
              onChange={(event) => setRequestId(event.target.value)}
            >
              <option value="">Not about a request</option>
              {(requests.data?.items ?? []).map((request) => (
                <option key={request.id} value={request.id}>
                  {request.target.name} ({request.reference})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!classification}
            loading={classify.isPending}
          >
            Classify
          </Button>
        </div>
      </form>
    </Card>
  );
}
