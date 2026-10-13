import { US_STATES } from "@kickrocks/shared";
import { ChevronRight } from "lucide-react";
import { useCurrentProfile } from "../../api/index.js";
import { Icon, Row, RowGroup, Section } from "../../components/ui/index.js";
import { paths } from "../../lib/paths.js";

/** Who the requests are for, as one line that leads to the profile. */
export function ProfileRow() {
  const { profile, isLoading } = useCurrentProfile();
  if (isLoading) return null;

  return (
    <Section label="Profile">
      <RowGroup>
        {profile ? (
          <Row
            to={paths.profile(profile.id)}
            title={`${profile.displayName} · ${US_STATES.find((state) => state.code === profile.state)?.name ?? profile.state}`}
            trailing={<Icon icon={ChevronRight} className="text-ink-3" />}
          />
        ) : (
          <Row
            to="/profiles/new"
            title={
              <>
                No profile yet · <span className="text-accent-text">Create</span>
              </>
            }
          />
        )}
      </RowGroup>
    </Section>
  );
}
