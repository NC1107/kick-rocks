import { API_ROUTES, type Match, type RequestRight } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  ExternalLinkText,
  useToast,
} from "../../components/ui/index.js";
import { RIGHT_LABELS } from "../../lib/labels.js";
import { REVIEW_INVALIDATES } from "./model.js";

const RIGHT_ORDER: readonly RequestRight[] = ["opt_out", "delete"];

function Fact({ label, values }: { label: string; values: readonly string[] | undefined }) {
  if (!values || values.length === 0) return null;
  return (
    <>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-base text-ink">
        {values.join(label === "Locations" ? "; " : ", ")}
      </dd>
    </>
  );
}

export function MatchCard({ match }: { match: Match }) {
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
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });

  const { fields } = match;
  const toggleRight = (right: RequestRight, on: boolean) =>
    setRights((current) =>
      RIGHT_ORDER.filter((candidate) => (candidate === right ? on : current.includes(candidate))),
    );

  return (
    <Card aria-label={`${fields.name} on ${match.targetName}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold text-ink">{fields.name}</h2>
          <p className="text-sm text-ink-muted">Found on {match.targetName}</p>
        </div>
        {fields.age !== undefined ? (
          <p className="text-base text-ink-muted">Age {fields.age}</p>
        ) : null}
      </div>

      <dl className="m-0 mt-3 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 sm:grid-cols-[7rem_1fr]">
        <Fact label="Locations" values={fields.locations} />
        <Fact label="Relatives" values={fields.relatives} />
        <Fact label="Phones" values={fields.phones} />
        <Fact label="Emails" values={fields.emails} />
        <dt className="text-sm text-ink-muted">Record</dt>
        <dd className="m-0 min-w-0 text-base">
          <ExternalLinkText href={match.recordUrl} className="break-all">
            {match.recordUrl}
          </ExternalLinkText>
        </dd>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setOpen(true)} disabled={decide.isPending}>
          This is me
        </Button>
        <Button
          loading={decide.isPending && decide.variables?.body.decision === "not_mine"}
          disabled={decide.isPending}
          onClick={() =>
            decide.mutate({
              params: { id: match.id },
              body: { decision: "not_mine", rights: ["opt_out", "delete"] },
            })
          }
        >
          Not me
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Remove this record"
        description={`Kick Rocks asks ${match.targetName} to take this listing down. Only confirm a record that is yours.`}
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
          <legend className="mb-2 p-0 text-sm font-medium text-ink">Ask them to</legend>
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
          {rights.length === 0 ? (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              Choose at least one.
            </p>
          ) : null}
        </fieldset>
      </Dialog>
    </Card>
  );
}
