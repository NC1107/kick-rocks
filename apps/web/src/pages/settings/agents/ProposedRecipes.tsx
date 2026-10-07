import { API_ROUTES, type RecipeRecord } from "@kickrocks/shared";
import { ChevronDown, FileCode } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  SkeletonText,
  useToast,
} from "../../../components/ui/index.js";
import { formatRelative, pluralize } from "../../../lib/format.js";
import { describeStep } from "../model.js";

function RecipeCard({ recipe }: { recipe: RecipeRecord }) {
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
          <p className="text-sm text-ink-muted">
            Proposed {purpose} steps, version {recipe.version},{" "}
            <time dateTime={recipe.createdAt}>{formatRelative(recipe.createdAt)}</time>
          </p>
        </div>
        <Badge tone="amber">Waiting for review</Badge>
      </div>

      {recipe.notes ? <p className="mt-3 break-words text-base text-ink">{recipe.notes}</p> : null}

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
          Approve
        </Button>
        <Button variant="ghost" disabled={approve.isPending} onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </div>

      <ConfirmDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject this recipe?"
        description="It is discarded and the agent has to propose it again."
        confirmLabel="Reject"
        destructive
        loading={reject.isPending}
        onConfirm={() => reject.mutate({ params: { id: recipe.id } })}
      />
    </Card>
  );
}

export function ProposedRecipes() {
  const query = useApiQuery(API_ROUTES.recipesList, { query: { status: "pending_review" } });
  return (
    <section aria-labelledby="proposed-heading">
      <h2 id="proposed-heading" className="text-lg font-semibold text-ink">
        Proposed recipes
      </h2>
      <p className="mt-0.5 mb-3 text-sm text-ink-muted">
        An agent that fixes or writes steps for a site proposes them here. Nothing runs until you
        approve it.
      </p>
      {query.isPending ? (
        <Card>
          <span className="sr-only">Loading proposed recipes</span>
          <SkeletonText lines={3} />
        </Card>
      ) : query.isError ? (
        <Alert
          intent="danger"
          title="Could not load proposed recipes"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      ) : query.data.recipes.length === 0 ? (
        <EmptyState
          icon={FileCode}
          title="No proposed recipes"
          description="When an agent proposes steps for a site, they wait here for you."
          className="py-8"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {query.data.recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </section>
  );
}
