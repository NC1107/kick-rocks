import { API_ROUTES, type Match, type RequestRight } from "@kickrocks/shared";
import { type ReactNode, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Button, Checkbox, Dialog, InlineError, useToast } from "../../components/ui/index.js";
import { RIGHT_LABELS } from "../../lib/labels.js";
import { REVIEW_INVALIDATES } from "./model.js";

const RIGHT_ORDER: readonly RequestRight[] = ["opt_out", "delete"];

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
  const [rights, setRights] = useState<readonly RequestRight[]>(["opt_out", "delete"]);

  const decide = useApiMutation(API_ROUTES.matchDecide, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: (_result, variables) => {
      setOpen(false);
      toast.success(
        variables.body.decision === "mine" ? "Removal request queued" : "Marked as not you",
      );
    },
  });

  const toggleRight = (right: RequestRight, on: boolean) =>
    setRights((current) =>
      RIGHT_ORDER.filter((candidate) => (candidate === right ? on : current.includes(candidate))),
    );

  const dialog = (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Remove this record"
      description={`Asks ${match.targetName} to take this record down. Only confirm a record that is yours.`}
      dismissible={!decide.isPending}
      footer={
        <>
          <Button onClick={() => setOpen(false)} disabled={decide.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={rights.length === 0}
            loading={decide.isPending}
            onClick={() =>
              decide.mutate({
                params: { id: match.id },
                body: { decision: "mine", rights: [...rights] },
              })
            }
          >
            Remove this record
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
        {decide.isError ? (
          <InlineError className="mt-2">{errorMessage(decide.error)}</InlineError>
        ) : null}
        {rights.length === 0 ? (
          <p role="alert" className="mt-2 text-caption text-danger-text">
            Choose at least one.
          </p>
        ) : null}
      </fieldset>
    </Dialog>
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
