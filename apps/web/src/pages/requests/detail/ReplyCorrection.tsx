import { API_ROUTES, type MessageSummary, type ReplyClassification } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  ConfirmDialog,
  Field,
  InlineError,
  Select,
  useToast,
} from "../../../components/ui/index.js";
import { CLASSIFICATION_LABELS } from "../../../lib/labels.js";
import { CHOICES, CLASSIFICATION_HELP, SETTLES } from "../../review/MailDetail.js";

/**
 * Lets the person say what a reply really was when the rules or the model read it wrong. It is the
 * same call the review queue makes, so the answer is applied to the request exactly as an automatic
 * one would be, with the person as the actor.
 */
export function ReplyCorrection({ message }: { message: MessageSummary }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ReplyClassification | "">("");
  const [confirming, setConfirming] = useState(false);

  const classify = useApiMutation(API_ROUTES.messageClassify, {
    invalidates: [
      API_ROUTES.requestsGet,
      API_ROUTES.requestsList,
      API_ROUTES.dashboardGet,
      API_ROUTES.reviewQueue,
    ],
    onSuccess: (_result, variables) => {
      setConfirming(false);
      setOpen(false);
      setChoice("");
      toast.success(
        `Classified as ${CLASSIFICATION_LABELS[variables.body.classification].toLowerCase()}`,
      );
    },
    onError: () => setConfirming(false),
  });

  const submit = () => {
    if (!choice) return;
    classify.mutate({ params: { id: message.id }, body: { classification: choice } });
  };

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Correct this
      </Button>
    );
  }

  return (
    <>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (choice && SETTLES.has(choice)) setConfirming(true);
          else submit();
        }}
      >
        <Field
          label="What this reply is"
          help={choice ? CLASSIFICATION_HELP[choice] : undefined}
          className="sm:min-w-64"
        >
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
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!choice} loading={classify.isPending}>
            Apply
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
      {classify.isError ? <InlineError>{errorMessage(classify.error)}</InlineError> : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Mark this reply as ${choice ? CLASSIFICATION_LABELS[choice].toLowerCase() : ""}?`}
        description={choice ? CLASSIFICATION_HELP[choice] : undefined}
        confirmLabel="Classify"
        loading={classify.isPending}
        onConfirm={submit}
      />
    </>
  );
}
