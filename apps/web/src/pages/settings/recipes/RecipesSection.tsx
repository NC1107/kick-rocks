import { API_ROUTES, type RecipeStatus } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import {
  Button,
  Callout,
  EmptyState,
  RowGroup,
  Section,
  SkeletonText,
} from "../../../components/ui/index.js";
import { ProposedRecipes } from "../agents/ProposedRecipes.js";
import { RecipeCard, type RecipeCardCopy } from "../RecipeCard.js";
import { BodyRow, GroupNote } from "../rows.js";

const COPY: RecipeCardCopy = {
  origin: (purpose, recipe) => (
    <>
      Bundled {purpose} steps, version {recipe.version}
    </>
  ),
  rejectDescription: "Rejected steps do not run.",
  notesHeading: "What was and was not checked",
  showChecked: true,
};

function useBundled(status: RecipeStatus) {
  return useApiQuery(API_ROUTES.recipesList, { query: { status, source: "bundled" } });
}

export function RecipesSection() {
  const pending = useBundled("pending_review");
  const rejected = useBundled("rejected");

  return (
    <>
      <Section
        label="Recipes to check"
        {...(pending.data ? { count: pending.data.recipes.length } : {})}
      >
        {pending.isPending ? (
          <RowGroup aria-busy="true">
            <BodyRow>
              <span className="sr-only">Loading bundled recipes</span>
              <SkeletonText lines={3} />
            </BodyRow>
          </RowGroup>
        ) : pending.isError ? (
          <Callout
            intent="danger"
            title="Could not load bundled recipes"
            action={
              <Button size="sm" onClick={() => pending.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(pending.error)}
          </Callout>
        ) : pending.data.recipes.length === 0 ? (
          <EmptyState title="Nothing to check" />
        ) : (
          <>
            <GroupNote className="mt-0 mb-3 max-w-prose">Untested on live sites.</GroupNote>
            <div className="flex flex-col gap-3">
              {pending.data.recipes.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} />
              ))}
            </div>
          </>
        )}
      </Section>

      {rejected.data && rejected.data.recipes.length > 0 ? (
        <Section label="Rejected recipes" count={rejected.data.recipes.length}>
          <GroupNote className="mt-0 mb-3">You can still approve these.</GroupNote>
          <div className="flex flex-col gap-3">
            {rejected.data.recipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} rejected />
            ))}
          </div>
        </Section>
      ) : null}
      <ProposedRecipes />
    </>
  );
}
