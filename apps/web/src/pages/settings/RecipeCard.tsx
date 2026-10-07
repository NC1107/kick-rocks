import { API_ROUTES, type Recipe, type RecipeRecord } from "@kickrocks/shared";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Button,
  ConfirmDialog,
  RowGroup,
  StatusShapeGlyph,
  useToast,
} from "../../components/ui/index.js";
import { pluralize } from "../../lib/format.js";
import { describeStep } from "./model.js";
import { GroupFooter } from "./rows.js";

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
    <>
      <RowGroup role="region" aria-label={`${recipe.targetName} ${purpose} recipe`}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3.5 py-2.5">
          <div className="min-w-0">
            <h3 className="break-words text-ui font-medium text-ink">
              <Link
                to={`/targets/${encodeURIComponent(recipe.targetId)}`}
                className="rounded-xs hover:text-accent-text hover:underline"
              >
                {recipe.targetName}
              </Link>
            </h3>
            <p className="text-meta text-ink-3">{copy.origin(purpose, recipe)}</p>
          </div>
          <span className="inline-flex items-center gap-2 text-meta">
            <StatusShapeGlyph shape={rejected ? "dash" : "triangle"} />
            <span className={rejected ? "text-ink-2" : "font-medium text-attention-text"}>
              {rejected ? "Rejected" : "Waiting for review"}
            </span>
          </span>
        </div>

        {copy.showChecked || recipe.notes ? (
          <div className="flex flex-col gap-2 px-3.5 py-2.5 text-meta">
            {copy.showChecked ? (
              <p className="font-medium text-ink">{LIVE_STATUS_TEXT[definition.liveStatus]}</p>
            ) : null}
            {recipe.notes ? (
              <div>
                {copy.notesHeading ? (
                  <h4 className="text-eyebrow text-ink-3">{copy.notesHeading}</h4>
                ) : null}
                <p className="mt-1 break-words text-ink-2">{recipe.notes}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <details className="group">
          <summary className="flex min-h-row cursor-pointer list-none items-center justify-between px-3.5 py-1.5 text-ui text-ink transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
            <span className="font-mono text-meta tabular-nums">
              {pluralize(definition.steps.length, "step")}
            </span>
            <ChevronDown
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-4 text-ink-3 transition-transform duration-100 group-open:rotate-180"
            />
          </summary>
          <ol className="m-0 list-decimal border-t border-line bg-canvas py-2 pr-3.5 pl-9 text-meta text-ink-2">
            {definition.steps.map((step, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps have no id, and their order is their identity
              <li key={index} className="break-words py-0.5">
                {describeStep(step)}
              </li>
            ))}
          </ol>
        </details>

        <GroupFooter>
          {rejected ? null : (
            <Button variant="ghost" disabled={approve.isPending} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          )}
          <Button
            variant="secondary"
            loading={approve.isPending}
            disabled={reject.isPending}
            onClick={() => approve.mutate({ params: { id: recipe.id } })}
          >
            {rejected ? "Approve anyway" : "Approve"}
          </Button>
        </GroupFooter>
      </RowGroup>

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
    </>
  );
}
