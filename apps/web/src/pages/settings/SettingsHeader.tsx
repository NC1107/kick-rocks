import type { ReactNode } from "react";
import { LinkTabs, PageHeader } from "../../components/ui/index.js";

const TABS = [
  { to: "/settings", label: "General", end: true },
  { to: "/settings/profiles", label: "Profiles" },
  { to: "/settings/recipes", label: "Recipes" },
  { to: "/settings/agents", label: "Agents" },
  { to: "/settings/notifications", label: "Notifications" },
  { to: "/settings/about", label: "About" },
] as const;

/** The heading and section tabs every settings page shares, so they read as one place. */
export function SettingsHeader({
  section,
  description,
  actions,
  hideDescriptionOnPhone,
}: {
  section: (typeof TABS)[number]["label"];
  description: string;
  actions?: ReactNode;
  hideDescriptionOnPhone?: boolean;
}) {
  return (
    <>
      <PageHeader
        title="Settings"
        documentTitle={`${section} - Settings`}
        description={description}
        actions={actions}
        {...(hideDescriptionOnPhone ? { hideDescriptionOnPhone } : {})}
      />
      <div className="mb-5">
        <LinkTabs items={TABS} label="Settings sections" />
      </div>
    </>
  );
}
