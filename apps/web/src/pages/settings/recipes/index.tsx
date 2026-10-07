import { API_ROUTES, type RecipeStatus } from "@kickrocks/shared";
import { FileCheck } from "lucide-react";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Alert, Button, Card, EmptyState, SkeletonText } from "../../../components/ui/index.js";
import { pluralize } from "../../../lib/format.js";
import { RecipeCard, type RecipeCardCopy } from "../RecipeCard.js";
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
      <SettingsHeader description="Check the steps that ship with Kick Rocks but were not seen through on the real site." />
      <section aria-labelledby="bundled-heading">
        <h2 id="bundled-heading" className="text-lg font-semibold text-ink">
          Bundled recipes to check
        </h2>
        <p className="mt-0.5 mb-3 max-w-prose text-sm text-ink-muted">
          Each recipe is a script for one site. The author did not see these through to a real
          request on the live site, so they do not run on your details until you approve them. Read
          what was checked, then approve or reject each one. Until then the site is handled by an
          agent or by you.
        </p>
        {pending.isPending ? (
          <Card aria-busy="true">
            <span className="sr-only">Loading bundled recipes</span>
            <SkeletonText lines={3} />
          </Card>
        ) : pending.isError ? (
          <Alert
            intent="danger"
            title="Could not load bundled recipes"
            action={
              <Button size="sm" onClick={() => pending.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(pending.error)}
          </Alert>
        ) : pending.data.recipes.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title="Nothing to check"
            description="Every bundled recipe has been decided."
            className="py-8"
          />
        ) : (
          <div className="flex flex-col gap-4">
            {pending.data.recipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} />
            ))}
          </div>
        )}
      </section>

      {rejected.data && rejected.data.recipes.length > 0 ? (
        <section aria-labelledby="rejected-heading" className="mt-8">
          <h2 id="rejected-heading" className="text-lg font-semibold text-ink">
            Rejected bundled recipes
          </h2>
          <p className="mt-0.5 mb-3 text-sm text-ink-muted">
            {pluralize(rejected.data.recipes.length, "recipe")} you rejected. They stay rejected
            until a newer version ships, and you can still approve one.
          </p>
          <div className="flex flex-col gap-4">
            {rejected.data.recipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} copy={COPY} rejected />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
