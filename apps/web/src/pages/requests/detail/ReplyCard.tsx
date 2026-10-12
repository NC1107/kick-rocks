import { API_ROUTES, type MessageSummary, type ReplyClassification } from "@kickrocks/shared";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  Dialog,
  Field,
  IconButton,
  InlineError,
  Menu,
  type MenuItem,
  Select,
  SkeletonText,
  Tag,
  useToast,
} from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { formatDateTime } from "../../../lib/format.js";
import { CLASSIFICATION_LABELS } from "../../../lib/labels.js";
import { CHOICES, CLASSIFICATION_HELP, QUICK_PICKS, SETTLES } from "../../review/MailDetail.js";

const FORM_OR_PHONE =
  /\b(web ?forms?|online forms?|forms?|portal|phone|call us|telephone)\b|\d{3}[-. )]\s?\d{3}[-. ]\d{4}/i;

/** Whether a reply sends the person somewhere else to make the request, which is the usual misread. */
export function mentionsFormOrPhone(text: string): boolean {
  return FORM_OR_PHONE.test(text);
}

/** The answers worth one tap, with the web form first when the reply talks about one. */
export function correctionPicks(
  current: ReplyClassification,
  text: string,
): readonly ReplyClassification[] {
  const picks = mentionsFormOrPhone(text) ? ["needs_form", ...QUICK_PICKS] : [...QUICK_PICKS];
  return picks.filter((pick): pick is ReplyClassification => pick !== current);
}

function FullText({ messageId }: { messageId: string }) {
  const query = useApiQuery(API_ROUTES.messageGet, { params: { id: messageId } });
  if (query.isPending) return <SkeletonText lines={4} />;
  if (query.isError) {
    return (
      <Callout intent="danger" title="Could not load the message">
        {errorMessage(query.error)}
      </Callout>
    );
  }
  return (
    <pre className="m-0 whitespace-pre-wrap break-words rounded-md bg-hover p-3 font-sans text-ui text-ink">
      {query.data.text ?? "This message has no text."}
    </pre>
  );
}

export interface ReplyCardProps {
  message: MessageSummary;
  /** The request the reply belongs to, which the card's answers are applied to through the message. */
  requestId: string;
  defaultExpanded?: boolean;
}

/**
 * One reply from the target. Its classification tag is also the way to correct it, because a
 * misread reply, such as a receipt that really says "use our web form", is the one thing on this
 * page that quietly keeps a request stuck. The answer is applied exactly as the review queue
 * would apply it, with the person as the actor.
 */
export function ReplyCard({ message, defaultExpanded = false }: ReplyCardProps) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [other, setOther] = useState(false);
  const [choice, setChoice] = useState<ReplyClassification | "">("");
  const [confirming, setConfirming] = useState<ReplyClassification | null>(null);

  const classify = useApiMutation(API_ROUTES.messageClassify, {
    invalidates: [
      API_ROUTES.requestsGet,
      API_ROUTES.requestsList,
      API_ROUTES.requestsListAll,
      API_ROUTES.dashboardGet,
      API_ROUTES.reviewQueue,
    ],
    onSuccess: (_result, variables) => {
      setConfirming(null);
      setOther(false);
      setChoice("");
      toast.success(
        `Classified as ${CLASSIFICATION_LABELS[variables.body.classification].toLowerCase()}`,
      );
    },
    onError: () => setConfirming(null),
  });

  const apply = (classification: ReplyClassification) => {
    if (SETTLES.has(classification)) {
      setOther(false);
      setConfirming(classification);
      return;
    }
    classify.mutate({ params: { id: message.id }, body: { classification } });
  };

  const picks = correctionPicks(
    message.classification,
    `${message.subject} ${message.snippet ?? ""}`,
  );
  const items: MenuItem[] = [
    ...picks.map((pick) => ({
      id: pick,
      label: CLASSIFICATION_LABELS[pick],
      description: CLASSIFICATION_HELP[pick],
      onSelect: () => apply(pick),
    })),
    {
      id: "other",
      label: "Other...",
      separatorBefore: true,
      onSelect: () => setOther(true),
    },
  ];

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-ui font-medium text-ink">{message.subject}</p>
        <Menu
          align="end"
          heading="This reply is"
          items={items}
          trigger={(props) => (
            <button
              type="button"
              aria-label={`${CLASSIFICATION_LABELS[message.classification]}. Change what this reply is`}
              {...props}
              className="-my-1 inline-flex shrink-0 items-center rounded-xs pointer-coarse:-my-3 pointer-coarse:min-h-11"
            >
              <Tag className="gap-1">
                {CLASSIFICATION_LABELS[message.classification]}
                <ChevronDown aria-hidden="true" className="size-3" />
              </Tag>
            </button>
          )}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 break-words font-mono text-caption text-ink-3">
          {message.fromAddress},{" "}
          <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
        </p>
        <IconButton
          label={expanded ? "Show less of the message" : "Read the whole message"}
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="pointer-coarse:-my-2"
        >
          <ChevronDown
            className={cn("transition-transform duration-100", expanded && "rotate-180")}
          />
        </IconButton>
      </div>
      <div className="mt-1.5">
        {expanded ? (
          <FullText messageId={message.id} />
        ) : message.snippet ? (
          <p data-user-content className="line-clamp-2 break-words text-ui text-ink">
            {message.snippet}
          </p>
        ) : null}
      </div>
      {classify.isError ? (
        <InlineError className="mt-2">{errorMessage(classify.error)}</InlineError>
      ) : null}

      <Dialog
        open={other}
        onClose={() => setOther(false)}
        size="sm"
        title="What this reply is"
        description={choice ? CLASSIFICATION_HELP[choice] : undefined}
        footer={
          <>
            <Button onClick={() => setOther(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!choice}
              loading={classify.isPending}
              onClick={() => choice && apply(choice)}
            >
              Apply
            </Button>
          </>
        }
      >
        <Field label="What this reply is">
          <Select
            value={choice}
            onChange={(event) => setChoice(event.target.value as ReplyClassification)}
          >
            <option value="">Choose one</option>
            {CHOICES.filter((option) => option !== message.classification).map((option) => (
              <option key={option} value={option}>
                {CLASSIFICATION_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={`Mark this reply as ${confirming ? CLASSIFICATION_LABELS[confirming].toLowerCase() : ""}?`}
        description={confirming ? CLASSIFICATION_HELP[confirming] : undefined}
        confirmLabel="Classify"
        loading={classify.isPending}
        onConfirm={() =>
          confirming &&
          classify.mutate({ params: { id: message.id }, body: { classification: confirming } })
        }
      />
    </div>
  );
}
