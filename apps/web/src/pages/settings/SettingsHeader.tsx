import { LinkTabs, PageHeader } from "../../components/ui/index.js";

const TABS = [
  { to: "/settings", label: "General", end: true },
  { to: "/settings/recipes", label: "Recipes" },
  { to: "/settings/agents", label: "Agents" },
  { to: "/settings/notifications", label: "Notifications" },
] as const;

/** The heading and section tabs both settings pages share, so the two read as one place. */
export function SettingsHeader({ description }: { description: string }) {
  return (
    <>
      <PageHeader title="Settings" description={description} />
      <div className="mb-5">
        <LinkTabs items={TABS} label="Settings sections" />
      </div>
    </>
  );
}
