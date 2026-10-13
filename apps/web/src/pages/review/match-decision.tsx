import { API_ROUTES, type Match, type RequestRight } from "@kickrocks/shared";
import { type ReactNode, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Button, Checkbox, Dialog, InlineError, useToast } from "../../components/ui/index.js";
import { RIGHT_LABELS } from "../../lib/labels.js";
import { REVIEW_INVALIDATES } from "./model.js";

const RIGHT_ORDER: readonly RequestRight[] = ["opt_out", "delete"];

/** Asks which rights a removal uses, once, whether it covers one record or several. */
export function RightsDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: string | undefined;
  onConfirm: (rights: readonly RequestRight[]) => void;
}) {
  const [rights, setRights] = useState<readonly RequestRight[]>(RIGHT_ORDER);

  const toggleRight = (right: RequestRight, on: boolean) =>
    setRights((current) =>
      RIGHT_ORDER.filter((candidate) => (candidate === right ? on : current.includes(candidate))),
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      dismissible={!pending}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={rights.length === 0}
            loading={pending}
            onClick={() => onConfirm(rights)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 p-0 text-caption font-medium text-ink-2">Ask them to</legend>
        <div className="flex flex-col gap-2.5">
          {RIGHT_ORDER.map((right) => (
            <Checkbox
              key={right}
              label={RIGHT_LABELS[right]}
              checked={rights.includes(right)}
              onChange={(event) => toggleRight(right, event.target.checked)}
            />
          ))}
        </div>
        {error ? <InlineError className="mt-2">{error}</InlineError> : null}
        {rights.length === 0 ? (
          <p role="alert" className="mt-2 text-caption text-danger-text">
            Choose at least one.
          </p>
        ) : null}
      </fieldset>
    </Dialog>
  );
}

export interface MatchDecision {
  /** Opens the dialog that asks which rights to use before a removal is opened. */
  askMine: () => void;
  notMine: () => void;
  deciding: boolean;
  decidingNotMine: boolean;
  /** Why the last decision failed, while the dialog that asked for it is closed. */
  error: string | undefined;
  dialog: ReactNode;
}

/**
 * The person's answer about one record a scan found. "This is me" asks which rights to use and
 * opens the removal for that exact record; "Not me" closes it. No campaign is involved, so the
 * same logic serves the review queue and the listing of a site.
 */
export function useMatchDecision(match: Match): MatchDecision {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const decide = useApiMutation(API_ROUTES.matchDecide, {
    invalidates: [...REVIEW_INVALIDATES, API_ROUTES.listingsList],
    onSuccess: (_result, variables) => {
      setOpen(false);
      toast.success(
        variables.body.decision === "mine" ? "Removal request queued" : "Marked as not you",
      );
    },
  });

  const dialog = (
    <RightsDialog
      open={open}
      onClose={() => setOpen(false)}
      title="Remove this record"
      description={`Asks ${match.targetName} to take this record down. Only confirm a record that is yours.`}
      confirmLabel="Remove this record"
      pending={decide.isPending}
      error={decide.isError ? errorMessage(decide.error) : undefined}
      onConfirm={(rights) =>
        decide.mutate({
          params: { id: match.id },
          body: { decision: "mine", rights: [...rights] },
        })
      }
    />
  );

  return {
    askMine: () => setOpen(true),
    notMine: () =>
      decide.mutate({
        params: { id: match.id },
        body: { decision: "not_mine", rights: ["opt_out", "delete"] },
      }),
    deciding: decide.isPending,
    decidingNotMine: decide.isPending && decide.variables?.body.decision === "not_mine",
    error: decide.isError && !open ? errorMessage(decide.error) : undefined,
    dialog,
  };
}
