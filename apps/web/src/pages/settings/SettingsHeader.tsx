import type { ReactNode } from "react";
import { LinkTabs, PageHeader } from "../../components/ui/index.js";

const TABS = [
  { to: "/settings", label: "Setup", end: true },
  { to: "/settings/advanced", label: "Advanced" },
  { to: "/settings/profiles", label: "Profiles" },
  { to: "/settings/notifications", label: "Notifications" },
  { to: "/targets", label: "Sites" },
  { to: "/settings/about", label: "About" },
] as const;

type TabLabel = (typeof TABS)[number]["label"];

/** The heading and section tabs every settings page shares, so they read as one place. */
export function SettingsHeader({
  section,
  description,
  actions,
  hideDescriptionOnPhone,
}: {
  section: Exclude<TabLabel, "Sites">;
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
