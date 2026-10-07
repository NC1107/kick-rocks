import { API_ROUTES, ReplyClassification, type ReviewMessage } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ExternalLinkText,
  Field,
  Select,
  useToast,
} from "../../components/ui/index.js";
import { formatDateTime } from "../../lib/format.js";
import { CLASSIFICATION_LABELS } from "../../lib/labels.js";
import { MessageBody } from "./MessageBody.js";
import { REVIEW_INVALIDATES } from "./model.js";

/** What choosing each answer does, since a few of them settle the request. */
const CLASSIFICATION_HELP: Partial<Record<ReplyClassification, string>> = {
  bounce: "The email did not arrive. The request is marked bounced.",
  auto_ack: "A receipt only. Nothing changes.",
  confirmation_link: "Kick Rocks follows the link in it.",
  verification_required: "They want more details. You choose what to send.",
  completed: "They did what was asked. The request is marked confirmed.",
  no_record: "They hold nothing about you. The request is closed.",
  rejected: "They refused. The request is marked rejected.",
  needs_form: "They want their web form used instead.",
  unrelated: "Not about any request. Nothing changes.",
};

const CHOICES = ReplyClassification.options.filter((option) => option !== "unknown");

/** Choices that end the request, so the person is asked before one is applied. */
const SETTLES: ReadonlySet<ReplyClassification> = new Set(["completed", "no_record", "rejected"]);

/** Mail nobody could classify. The person says what it is, and may attach it to a request. */
export function MessageCard({ message, profileId }: { message: ReviewMessage; profileId: string }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
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
    onSuccess: () => {
      setConfirming(false);
      toast.success("Message classified");
    },
    onError: (error) => {
      setConfirming(false);
      toast.error("That did not work", errorMessage(error));
    },
  });
  const settlesRequest =
    classification !== "" &&
    SETTLES.has(classification) &&
    (message.requestId !== null || requestId !== "");
  const submit = () => {
    if (!classification) return;
    classify.mutate({
      params: { id: message.id },
      body: { classification, ...(requestId ? { requestId } : {}) },
    });
  };

  return (
    <Card aria-label={message.subject}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold text-ink">{message.subject}</h2>
          <p className="break-words text-sm text-ink-muted">
            From {message.fromAddress},{" "}
            <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
          </p>
        </div>
        <Badge tone="amber">Kick Rocks is unsure what this is</Badge>
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
        <MessageBody messageId={message.id} snippet={message.snippet} />
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
          if (settlesRequest) setConfirming(true);
          else submit();
        }}
      >
        <Field
          label="What is this message"
          help={classification ? CLASSIFICATION_HELP[classification] : undefined}
        >
          <Select
            value={classification}
            onChange={(event) => setClassification(event.target.value as ReplyClassification)}
          >
            <option value="">Choose one</option>
            {CHOICES.map((option) => (
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

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Mark this message as ${classification ? CLASSIFICATION_LABELS[classification].toLowerCase() : ""}?`}
        description={classification ? CLASSIFICATION_HELP[classification] : undefined}
        confirmLabel="Classify"
        loading={classify.isPending}
        onConfirm={submit}
      />
    </Card>
  );
}
