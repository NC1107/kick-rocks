import { API_ROUTES, type RecipeStatus } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
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

/** Approves every waiting recipe in turn, so twenty bundled recipes are one click, not twenty. */
function useApproveAll(ids: readonly string[]) {
  const [running, setRunning] = useState(false);
  const approve = useApiMutation(API_ROUTES.recipesApprove, {
    invalidates: [API_ROUTES.recipesList],
  });
  const run = async () => {
    setRunning(true);
    try {
      for (const id of ids) await approve.mutateAsync({ params: { id } });
    } finally {
      setRunning(false);
    }
  };
  return { run, running, error: approve.error ? errorMessage(approve.error) : null };
}

export function RecipesSection() {
  const pending = useBundled("pending_review");
  const rejected = useBundled("rejected");
  const waiting = pending.data?.recipes ?? [];
  const approveAll = useApproveAll(waiting.map((recipe) => recipe.id));

  return (
    <>
      <Section
        label="Recipes waiting for approval"
        {...(pending.data ? { count: waiting.length } : {})}
        actions={
          waiting.length > 1 ? (
            <Button size="sm" loading={approveAll.running} onClick={() => void approveAll.run()}>
              Approve all {waiting.length}
            </Button>
          ) : undefined
        }
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
            <GroupNote className="mt-0 mb-3 max-w-prose">
              A recipe is the scripted steps for one site. The worker only runs approved ones; each
              was checked by reading the form without sending anything.
            </GroupNote>
            {approveAll.error ? (
              <Callout intent="danger" title="Could not approve every recipe">
                {approveAll.error}
              </Callout>
            ) : null}
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
