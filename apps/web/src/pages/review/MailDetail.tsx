import { API_ROUTES, ReplyClassification, type ReviewMessage } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  EntityLink,
  ExternalLinkText,
  Field,
  Kbd,
  Section,
  Select,
  SkeletonText,
  useToast,
} from "../../components/ui/index.js";
import { ADMISSION_REASON } from "../../lib/admission.js";
import { formatDateTime } from "../../lib/format.js";
import { CLASSIFICATION_LABELS } from "../../lib/labels.js";
import { DetailFrame } from "./DetailFrame.js";
import { shortcutAllowed } from "./keys.js";
import { REVIEW_INVALIDATES } from "./model.js";

/** What choosing each answer does, since a few of them settle the request. */
export const CLASSIFICATION_HELP: Partial<Record<ReplyClassification, string>> = {
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

export const CHOICES = ReplyClassification.options.filter((option) => option !== "unknown");

/** Choices that end the request, so the person is asked before one is applied. */
export const SETTLES: ReadonlySet<ReplyClassification> = new Set([
  "completed",
  "no_record",
  "rejected",
]);

/** The answers a person gives most often, so keys 1 to 4 reach them without opening the list. */
export const QUICK_PICKS: readonly ReplyClassification[] = [
  "auto_ack",
  "completed",
  "rejected",
  "unrelated",
];

/**
 * What the select starts on. A spot check is left unanswered because it measures the model, and a
 * suggestion that says nothing is not worth starting on.
 */
export function preselectOf(suggestion: ReviewMessage["suggestion"]): ReplyClassification | "" {
  if (!suggestion || suggestion.spotCheck || suggestion.classification === "unknown") return "";
  return suggestion.classification;
}

const SUGGESTERS = {
  rules: "the rules",
  model: "the reply model",
  llm: "the language model",
} as const;

/** The line above the select that says where the starting choice came from. */
export function suggestionLine(suggestion: ReviewMessage["suggestion"]): string | null {
  if (preselectOf(suggestion) === "" || !suggestion) return null;
  const by = `Suggested by ${SUGGESTERS[suggestion.source]}`;
  return suggestion.source === "rules"
    ? by
    : `${by}, ${Math.round(suggestion.confidence * 100)}% sure`;
}

/** The whole message, read in place. The snippet stands in until it arrives. */
function MailText({ message }: { message: ReviewMessage }) {
  const full = useApiQuery(API_ROUTES.messageGet, { params: { id: message.id } });
  if (full.isError) {
    return (
      <Callout intent="danger" title="Could not load the message">
        {errorMessage(full.error)}
      </Callout>
    );
  }
  const text = full.data ? (full.data.text ?? "This message has no text.") : message.snippet;
  return (
    <div aria-busy={full.isPending} className="border-l-2 border-line-strong pl-3">
      {text === null ? (
        <SkeletonText lines={3} />
      ) : (
        <p className="m-0 whitespace-pre-wrap break-words text-body text-ink">{text}</p>
      )}
    </div>
  );
}

/** Mail nobody could classify. The person says what it is, and may attach it to a request. */
export function MailDetail({ message, profileId }: { message: ReviewMessage; profileId: string }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [classification, setClassification] = useState<ReplyClassification | "">(() =>
    preselectOf(message.suggestion),
  );
  const suggested = suggestionLine(message.suggestion);
  const [requestId, setRequestId] = useState("");

  const needsRequest = message.requestId === null;
  const requests = useApiQuery(
    API_ROUTES.requestsList,
    needsRequest
      ? { params: { id: profileId }, query: { pageSize: 200 }, staleTime: 30_000 }
      : skipToken,
  );

  const chosen = requests.data?.items.find((request) => request.id === requestId);

  const classify = useApiMutation(API_ROUTES.messageClassify, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: (_result, variables) => {
      setConfirming(false);
      const settled = variables.body.requestId ?? message.requestId;
      toast.success(
        `Classified as ${CLASSIFICATION_LABELS[variables.body.classification].toLowerCase()}`,
        undefined,
        settled
          ? {
              action: {
                kind: "request",
                id: settled,
                reference: message.requestReference ?? chosen?.reference ?? null,
              },
            }
          : {},
      );
    },
    onError: () => setConfirming(false),
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const pick = QUICK_PICKS[Number(event.key) - 1];
      if (pick && shortcutAllowed(event)) setClassification(pick);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <DetailFrame
        label={message.subject}
        title={message.subject}
        meta={
          <>
            From <span className="font-mono">{message.fromAddress}</span>,{" "}
            <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
          </>
        }
        error={classify.isError ? errorMessage(classify.error) : undefined}
        footer={
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (settlesRequest) setConfirming(true);
              else submit();
            }}
          >
            {suggested ? <p className="m-0 text-meta text-ink-2">{suggested}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
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
                    requests.isError ? (
                      "The request list did not load. You can still classify it."
                    ) : chosen ? (
                      <>
                        <EntityLink
                          to={{ kind: "request", id: chosen.id, reference: chosen.reference }}
                        />{" "}
                        for{" "}
                        <EntityLink
                          to={{ kind: "target", id: chosen.target.id, name: chosen.target.name }}
                        />
                      </>
                    ) : undefined
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2 pointer-coarse:hidden">
                {QUICK_PICKS.map((pick, index) => (
                  <Button
                    key={pick}
                    size="sm"
                    variant="secondary"
                    aria-pressed={classification === pick}
                    aria-keyshortcuts={String(index + 1)}
                    className="aria-pressed:bg-accent-soft aria-pressed:text-accent-text"
                    onClick={() => setClassification(pick)}
                  >
                    <Kbd>{index + 1}</Kbd>
                    {CLASSIFICATION_LABELS[pick]}
                  </Button>
                ))}
              </div>
              <Button
                type="submit"
                variant="primary"
                className="ml-auto max-sm:w-full"
                disabled={!classification}
                loading={classify.isPending}
              >
                Classify
              </Button>
            </div>
          </form>
        }
      >
        {message.requestReference ? (
          <p className="text-ui text-ink-2">
            Matched to request{" "}
            <EntityLink
              to={{ kind: "request", id: message.requestId, reference: message.requestReference }}
            />
            {message.targetName ? (
              <>
                {" for "}
                <EntityLink
                  to={{ kind: "target", id: message.targetId, name: message.targetName }}
                />
              </>
            ) : null}
          </p>
        ) : null}

        {message.admittedBy || message.rationale ? (
          <p className="text-ui text-ink-2">
            {[
              message.admittedBy ? `${ADMISSION_REASON[message.admittedBy]}.` : null,
              message.rationale,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        ) : null}

        <MailText message={message} />

        {message.links.length > 0 ? (
          <Section label="Links in it" count={message.links.length} as="h3">
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {message.links.map((link) => (
                <li key={link} className="text-meta">
                  <ExternalLinkText href={link} className="break-all font-mono">
                    {link}
                  </ExternalLinkText>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </DetailFrame>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Mark this message as ${classification ? CLASSIFICATION_LABELS[classification].toLowerCase() : ""}?`}
        description={classification ? CLASSIFICATION_HELP[classification] : undefined}
        confirmLabel="Classify"
        loading={classify.isPending}
        onConfirm={submit}
      />
    </>
  );
}
