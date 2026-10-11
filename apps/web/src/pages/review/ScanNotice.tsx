import type { Dashboard } from "@kickrocks/shared";
import { Callout, LinkButton, RelativeTime } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { pluralize } from "../../lib/format.js";
import { paths } from "../../lib/paths.js";

/**
 * Says why scans are not running, and what to do, wherever scans are started or waited for. It
 * renders nothing when every people-search site can be scanned now. Scans that are already queued
 * say why they wait on their own rows, so `queuedHeld` leaves out what those rows already say.
 */
export function ScanNotice({
  scanning,
  profileId,
  queuedHeld = 0,
  className,
}: {
  scanning: Dashboard["scanning"];
  profileId: string;
  /** How many queued scans something already holds back. */
  queuedHeld?: number;
  className?: string | undefined;
}) {
  const { needsDetails, missing } = scanning;
  const explained = queuedHeld > 0;
  const noRecipe = explained ? 0 : scanning.noRecipe;
  const recipeNeedsReview = explained ? 0 : scanning.recipeNeedsReview;
  const quiet = explained ? null : scanning.quiet;
  if (needsDetails + noRecipe + recipeNeedsReview === 0 && !quiet) return null;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {needsDetails > 0 ? (
        <Callout
          intent="warning"
          title={`${pluralize(needsDetails, "site")} can't be scanned yet`}
          action={
            <LinkButton size="sm" to={paths.profile(profileId)}>
              Edit profile
            </LinkButton>
          }
        >
          Add {missing ?? "more details"} to this profile.
        </Callout>
      ) : null}
      {noRecipe > 0 ? (
        <Callout
          intent="info"
          title={`${pluralize(noRecipe, "site")} ${noRecipe === 1 ? "needs" : "need"} an agent`}
          action={
            <LinkButton size="sm" to={paths.settings("agents")}>
              Agents
            </LinkButton>
          }
        >
          No saved steps exist for {noRecipe === 1 ? "it" : "them"}, so only a connected agent can
          scan {noRecipe === 1 ? "it" : "them"}.
        </Callout>
      ) : null}
      {recipeNeedsReview > 0 ? (
        <Callout
          intent="info"
          title={`${pluralize(recipeNeedsReview, "site")} ${recipeNeedsReview === 1 ? "waits" : "wait"} for a recipe review`}
          action={
            <LinkButton size="sm" to={paths.settings("recipes")}>
              Recipes
            </LinkButton>
          }
        >
          Approve the saved steps and the built-in worker can scan{" "}
          {recipeNeedsReview === 1 ? "it" : "them"}.
        </Callout>
      ) : null}
      {quiet ? (
        <Callout
          intent="info"
          title="Quiet hours"
          action={
            quiet.zoneUnset ? (
              <LinkButton size="sm" to={paths.settings("scan-pace")}>
                Set time zone
              </LinkButton>
            ) : undefined
          }
        >
          Scans start again <RelativeTime iso={quiet.until} />.
          {quiet.zoneUnset ? " The time zone is the server's until you set yours." : ""}
        </Callout>
      ) : null}
    </div>
  );
}
