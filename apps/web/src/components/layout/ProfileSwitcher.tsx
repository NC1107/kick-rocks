import { ChevronsUpDown, Plus, Users } from "lucide-react";
import { useNavigate } from "react-router";
import { useCurrentProfile } from "../../api/index.js";
import { cn } from "../../lib/cn.js";
import { Menu, type MenuItem } from "../ui/index.js";
import { Skeleton } from "../ui/Skeleton.js";

function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Picks which profile every profile-scoped page works on. The choice is kept in localStorage, so
 * it survives a reload and is shared by every page.
 */
export function ProfileSwitcher({
  className,
  onSwitch,
}: {
  className?: string;
  /** Called after another profile is picked, so a drawer that holds the switcher can close. */
  onSwitch?: (() => void) | undefined;
}) {
  const { profile, profiles, isLoading, setProfileId } = useCurrentProfile();
  const navigate = useNavigate();

  if (isLoading) return <Skeleton className={cn("h-12 w-full rounded-md", className)} />;

  const items: MenuItem[] = [
    ...profiles.map((candidate) => ({
      id: candidate.id,
      label: candidate.displayName,
      description: candidate.primaryEmail ?? "No email",
      selected: candidate.id === profile?.id,
      onSelect: () => {
        setProfileId(candidate.id);
        onSwitch?.();
      },
    })),
    {
      id: "manage",
      label: "Manage profiles",
      icon: <Users aria-hidden="true" />,
      separatorBefore: profiles.length > 0,
      onSelect: () => navigate("/profiles"),
    },
    {
      id: "new",
      label: "Add a profile",
      icon: <Plus aria-hidden="true" />,
      onSelect: () => navigate("/profiles/new"),
    },
  ];

  return (
    <Menu
      className={className}
      panelClassName="w-72"
      heading="Switch profile"
      items={items}
      trigger={(triggerProps) => (
        <button
          type="button"
          {...triggerProps}
          aria-label={
            profile ? `Profile: ${profile.displayName}. Switch profile` : "Choose a profile"
          }
          className="flex h-12 w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2 text-left transition-colors duration-100 hover:bg-sunken"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-sm font-semibold text-accent-soft-ink"
          >
            {profile ? initialsOf(profile.displayName) : "?"}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium leading-5 text-ink">
              {profile?.displayName ?? "No profile yet"}
            </span>
            <span className="truncate text-xs leading-4 text-ink-muted">
              {profile ? (profile.primaryEmail ?? "No email") : "Add one to begin"}
            </span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </button>
      )}
    />
  );
}
