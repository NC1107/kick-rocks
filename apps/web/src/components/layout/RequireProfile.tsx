import type { ProfileSummary } from "@kickrocks/shared";
import { Users } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage, useCurrentProfile } from "../../api/index.js";
import { Alert, EmptyState, LinkButton, Skeleton } from "../ui/index.js";

/**
 * Wraps a page that works on one profile. While profiles load it shows a skeleton, with none it
 * shows the way to create one, and otherwise it calls children with the current profile.
 *
 *   <RequireProfile>{(profile) => <Requests profileId={profile.id} />}</RequireProfile>
 */
export function RequireProfile({ children }: { children: (profile: ProfileSummary) => ReactNode }) {
  const { profile, isLoading, error } = useCurrentProfile();
  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (error)
    return (
      <Alert intent="danger" title="Could not load profiles">
        {errorMessage(error)}
      </Alert>
    );
  if (!profile) {
    return (
      <EmptyState
        icon={Users}
        title="Create a profile first"
        description="Requests are sent on behalf of one person, so add the name and email to use before anything else."
        actions={
          <LinkButton to="/profiles/new" variant="primary">
            Create a profile
          </LinkButton>
        }
      />
    );
  }
  return children(profile);
}
