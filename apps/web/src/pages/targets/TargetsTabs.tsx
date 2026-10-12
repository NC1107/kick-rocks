import { LinkTabs } from "../../components/ui/index.js";

const TABS = [
  { to: "/targets", label: "All targets", end: true },
  { to: "/targets/listings", label: "Listings" },
] as const;

/** The two ways into the same sites: every target, and what is known about the person on each. */
export function TargetsTabs() {
  return (
    <div className="mb-5">
      <LinkTabs items={TABS} label="Targets views" />
    </div>
  );
}
