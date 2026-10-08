import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import {
  Button,
  Callout,
  EmptyState,
  RelativeTime,
  RowGroup,
  Section,
  SkeletonText,
} from "../../../components/ui/index.js";
import { RecipeCard, type RecipeCardCopy } from "../RecipeCard.js";
import { BodyRow } from "../rows.js";

const COPY: RecipeCardCopy = {
  origin: (purpose, recipe) => (
    <>
      Proposed {purpose} steps, version {recipe.version}, <RelativeTime iso={recipe.createdAt} />
    </>
  ),
  rejectDescription: "It is discarded and the agent has to propose it again.",
};

export function ProposedRecipes() {
  const query = useApiQuery(API_ROUTES.recipesList, {
    query: { status: "pending_review", source: "proposed" },
  });
  return (
    <Section label="Proposed recipes" {...(query.data ? { count: query.data.recipes.length } : {})}>
      {query.isPending ? (
        <RowGroup>
          <BodyRow>
            <span className="sr-only">Loading proposed recipes</span>
            <SkeletonText lines={3} />
          </BodyRow>
        </RowGroup>
      ) : query.isError ? (
        <Callout
          intent="danger"
          title="Could not load proposed recipes"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      ) : query.data.recipes.length === 0 ? (
        <EmptyState title="No proposed recipes" />
      ) : (
        <div className="flex flex-col gap-3">
          {query.data.recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} />
          ))}
        </div>
      )}
    </Section>
  );
}
