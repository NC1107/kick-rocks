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
import { RecipeCard, type RecipeCardCopy } from "../RecipeCard.js";
import { BodyRow, GroupNote, SETTINGS_WIDTH } from "../rows.js";
import { SettingsHeader } from "../SettingsHeader.js";

const COPY: RecipeCardCopy = {
  origin: (purpose, recipe) => (
    <>
      Bundled {purpose} steps, version {recipe.version}
    </>
  ),
  rejectDescription:
    "These steps will not run. Kick Rocks asks again only when a newer version of the recipe ships.",
  notesHeading: "What was and was not checked",
  showChecked: true,
};

function useBundled(status: RecipeStatus) {
  return useApiQuery(API_ROUTES.recipesList, { query: { status, source: "bundled" } });
}

export function Component() {
  const pending = useBundled("pending_review");
  const rejected = useBundled("rejected");

  return (
    <>
      <SettingsHeader description="Check bundled steps before they run on your details" />
      <div className={SETTINGS_WIDTH}>
        <Section
          label="Bundled recipes to check"
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
            <EmptyState
              title="Nothing to check"
              description="Every bundled recipe has been decided."
            />
          ) : (
            <>
              <GroupNote className="mt-0 mb-3 max-w-prose">
                The author did not see these through to a real request on the live site. They do not
                run on your details until you approve them.
              </GroupNote>
              <div className="flex flex-col gap-3">
                {pending.data.recipes.map((recipe) => (
                  <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} />
                ))}
              </div>
            </>
          )}
        </Section>

        {rejected.data && rejected.data.recipes.length > 0 ? (
          <Section
            label="Rejected bundled recipes"
            count={rejected.data.recipes.length}
            className="mt-6"
          >
            <GroupNote className="mt-0 mb-3">
              They stay rejected until a newer version ships. You can still approve one.
            </GroupNote>
            <div className="flex flex-col gap-3">
              {rejected.data.recipes.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} rejected />
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </>
  );
}
