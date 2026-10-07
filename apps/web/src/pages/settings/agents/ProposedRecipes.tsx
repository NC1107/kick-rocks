import { API_ROUTES } from "@kickrocks/shared";
import { FileCode } from "lucide-react";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Alert, Button, Card, EmptyState, SkeletonText } from "../../../components/ui/index.js";
import { formatRelative } from "../../../lib/format.js";
import { RecipeCard, type RecipeCardCopy } from "../RecipeCard.js";

const COPY: RecipeCardCopy = {
  origin: (purpose, recipe) => (
    <>
      Proposed {purpose} steps, version {recipe.version},{" "}
      <time dateTime={recipe.createdAt}>{formatRelative(recipe.createdAt)}</time>
    </>
  ),
  rejectDescription: "It is discarded and the agent has to propose it again.",
};

export function ProposedRecipes() {
  const query = useApiQuery(API_ROUTES.recipesList, {
    query: { status: "pending_review", source: "proposed" },
  });
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
            <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} />
          ))}
        </div>
      )}
    </section>
  );
}
