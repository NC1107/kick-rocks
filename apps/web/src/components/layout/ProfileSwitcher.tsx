import { ChevronsUpDown, Plus, Users } from "lucide-react";
import { useNavigate } from "react-router";
import { useCurrentProfile } from "../../api/index.js";
import { cn } from "../../lib/cn.js";
import { Menu, type MenuItem } from "../ui/index.js";
import { Skeleton } from "../ui/Skeleton.js";

const NAME_FILLER = new Set(["the", "of", "de", "van", "von", "jr", "sr", "ii", "iii", "iv"]);

/** The first two name parts, so a long or suffixed name still gives two stable letters. */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => word.length > 0 && !NAME_FILLER.has(word.toLowerCase().replace(/\.$/, "")));
  const second = words.slice(1).find((word) => word.length > 1) ?? words[1];
  return `${words[0]?.[0] ?? "?"}${second?.[0] ?? ""}`.toUpperCase();
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

  if (isLoading) return <Skeleton className={cn("h-10 w-full rounded-sm", className)} />;

  const items: MenuItem[] = [
    ...profiles.map((candidate) => ({
      id: candidate.id,
      label: candidate.displayName,
      description: candidate.primaryEmail ?? "No email",
      descriptionMono: candidate.primaryEmail !== null,
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

  // No aria-label: voice control matches the visible text, so the name must come from the content.
  const name = profile?.displayName ?? "No profile yet";
  const detail = profile ? (profile.primaryEmail ?? "No email") : "Add one to begin";

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
          className="flex h-10 w-full items-center gap-2.5 rounded-sm border border-line bg-surface px-2 text-left transition-colors duration-100 hover:bg-hover max-sm:h-12"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-active font-mono text-label font-semibold text-ink-2"
          >
            {profile ? initialsOf(profile.displayName) : "?"}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui leading-4 font-medium text-ink">{name}</span>
            <span className="truncate font-mono text-label leading-3.5 text-ink-3">{detail}</span>
          </span>
          <span className="sr-only">{profile ? "Switch profile" : "Choose a profile"}</span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-ink-3" />
        </button>
      )}
    />
  );
}
