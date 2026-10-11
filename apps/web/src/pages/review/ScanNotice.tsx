import type { Dashboard } from "@kickrocks/shared";
import { Callout, LinkButton, RelativeTime } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { pluralize } from "../../lib/format.js";
import { paths } from "../../lib/paths.js";

/**
 * Says why scans are not running, and what to do, wherever scans are started or waited for. It
 * renders nothing when every people-search site can be scanned now.
 */
export function ScanNotice({
  scanning,
  profileId,
  className,
}: {
  scanning: Dashboard["scanning"];
  profileId: string;
  className?: string | undefined;
}) {
  const { needsDetails, needsAgent, missing, quiet } = scanning;
  if (needsDetails === 0 && needsAgent === 0 && !quiet) return null;
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
      {needsAgent > 0 ? (
        <Callout
          intent="info"
          title={`${pluralize(needsAgent, "site")} need an agent`}
          action={
            <LinkButton size="sm" to="/settings/agents">
              Agents
            </LinkButton>
          }
        >
          No saved steps exist for them, so only a connected agent can scan them.
        </Callout>
      ) : null}
      {quiet ? (
        <Callout
          intent="info"
          title="Quiet hours"
          action={
            quiet.zoneUnset ? (
              <LinkButton size="sm" to="/settings">
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
