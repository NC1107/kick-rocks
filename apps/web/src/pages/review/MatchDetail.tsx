import { API_ROUTES, type Match, type RequestRight } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Button,
  Checkbox,
  type DescriptionItem,
  DescriptionList,
  Dialog,
  ExternalLinkText,
  useToast,
} from "../../components/ui/index.js";
import { RIGHT_LABELS } from "../../lib/labels.js";
import { DetailFrame } from "./DetailFrame.js";
import { REVIEW_INVALIDATES } from "./model.js";

const RIGHT_ORDER: readonly RequestRight[] = ["opt_out", "delete"];

function facts(fields: Match["fields"], recordUrl: string): DescriptionItem[] {
  const list = (term: string, values: readonly string[] | undefined, separator = ", ") =>
    values && values.length > 0 ? [{ term, description: values.join(separator) }] : [];
  return [
    ...list("Locations", fields.locations, "; "),
    ...list("Relatives", fields.relatives),
    ...list("Phones", fields.phones),
    ...list("Emails", fields.emails),
    {
      term: "Record",
      description: (
        <ExternalLinkText href={recordUrl} className="break-all font-mono text-meta">
          {recordUrl}
        </ExternalLinkText>
      ),
    },
  ];
}

export function MatchDetail({ match }: { match: Match }) {
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
    <>
      <DetailFrame
        label={`${fields.name} on ${match.targetName}`}
        title={fields.name}
        meta={
          <>
            Found on {match.targetName}
            {fields.age !== undefined ? `, age ${fields.age}` : ""}
          </>
        }
        footer={
          <>
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
          </>
        }
      >
        <DescriptionList items={facts(fields, match.recordUrl)} />
      </DetailFrame>

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
          {rights.length === 0 ? (
            <p role="alert" className="mt-2 text-caption text-danger-text">
              Choose at least one.
            </p>
          ) : null}
        </fieldset>
      </Dialog>
    </>
  );
}
