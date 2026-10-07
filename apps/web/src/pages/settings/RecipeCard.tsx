import { API_ROUTES, type Recipe, type RecipeRecord } from "@kickrocks/shared";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Badge, Button, Card, ConfirmDialog, useToast } from "../../components/ui/index.js";
import { pluralize } from "../../lib/format.js";
import { describeStep } from "./model.js";

export interface RecipeCardCopy {
  /** The line under the broker name, saying where the steps came from. */
  origin: (purpose: string, recipe: RecipeRecord) => ReactNode;
  /** What the person is told a rejection does. */
  rejectDescription: string;
  /** Heading above the recipe's notes, when it has any. */
  notesHeading?: string;
  /** Whether to say how far the author checked the recipe against the live site. */
  showChecked?: boolean;
}

const LIVE_STATUS_TEXT: Record<Recipe["liveStatus"], string> = {
  verified: "Checked through to the site accepting the request.",
  unverified: "The form was read but no real request was ever sent through it.",
  blocked_by_bot_protection: "Bot protection hid the site, so the steps could not be checked.",
};

export function RecipeCard({
  recipe,
  copy,
  rejected = false,
}: {
  recipe: RecipeRecord;
  copy: RecipeCardCopy;
  rejected?: boolean;
}) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const invalidates = [
    API_ROUTES.recipesList,
    API_ROUTES.targetsGet,
    API_ROUTES.targetsList,
  ] as const;

  const approve = useApiMutation(API_ROUTES.recipesApprove, {
    invalidates,
    onSuccess: () => toast.success("Recipe approved"),
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });
  const reject = useApiMutation(API_ROUTES.recipesReject, {
    invalidates,
    onSuccess: () => {
      setRejecting(false);
      toast.success("Recipe rejected");
    },
    onError: (error) => {
      setRejecting(false);
      toast.error("That did not work", errorMessage(error));
    },
  });

  const { definition } = recipe;
  const purpose = recipe.purpose === "scan" ? "scan" : "removal";

  return (
    <Card aria-label={`${recipe.targetName} ${purpose} recipe`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold text-ink">
            <Link
              to={`/targets/${encodeURIComponent(recipe.targetId)}`}
              className="rounded-xs hover:text-accent hover:underline"
            >
              {recipe.targetName}
            </Link>
          </h3>
          <p className="text-sm text-ink-muted">{copy.origin(purpose, recipe)}</p>
        </div>
        {rejected ? (
          <Badge tone="neutral">Rejected</Badge>
        ) : (
          <Badge tone="amber">Waiting for review</Badge>
        )}
      </div>

      {copy.showChecked ? (
        <p className="mt-3 text-sm font-medium text-ink">
          {LIVE_STATUS_TEXT[definition.liveStatus]}
        </p>
      ) : null}
      {recipe.notes ? (
        <>
          {copy.notesHeading ? (
            <h4 className="mt-3 text-sm font-medium text-ink-muted">{copy.notesHeading}</h4>
          ) : null}
          <p
            className={
              copy.notesHeading
                ? "mt-1 break-words text-base text-ink"
                : "mt-3 break-words text-base text-ink"
            }
          >
            {recipe.notes}
          </p>
        </>
      ) : null}

      <details className="group mt-3 rounded-md bg-sunken">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
          {pluralize(definition.steps.length, "step")}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          />
        </summary>
        <ol className="m-0 list-decimal px-3.5 pb-3 pl-8 text-base text-ink">
          {definition.steps.map((step, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps have no id, and their order is their identity
            <li key={index} className="break-words py-0.5">
              {describeStep(step)}
            </li>
          ))}
        </ol>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          loading={approve.isPending}
          disabled={reject.isPending}
          onClick={() => approve.mutate({ params: { id: recipe.id } })}
        >
          {rejected ? "Approve anyway" : "Approve"}
        </Button>
        {rejected ? null : (
          <Button variant="ghost" disabled={approve.isPending} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject this recipe?"
        description={copy.rejectDescription}
        confirmLabel="Reject"
        destructive
        loading={reject.isPending}
        onConfirm={() => reject.mutate({ params: { id: recipe.id } })}
      />
    </Card>
  );
}
