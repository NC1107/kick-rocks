import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Alert, Checkbox, RowGroup, Section, useToast } from "../../components/ui/index.js";
import { BodyRow, GroupNote } from "./rows.js";

export function SiteChecksCard({ siteChecks }: { siteChecks: SettingsView["siteChecks"] }) {
  const toast = useToast();
  const toggle = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (view) =>
      toast.success(view.siteChecks.enabled ? "Site checks turned on" : "Site checks turned off"),
  });

  return (
    <Section label="Site checks">
      <RowGroup>
        <BodyRow>
          <Checkbox
            label="Check recipe pages on the real broker sites"
            description="Off by default. Nothing is checked until you turn this on."
            checked={siteChecks.enabled}
            disabled={toggle.isPending}
            onChange={(event) =>
              toggle.mutate({ body: { siteChecks: { enabled: event.target.checked } } })
            }
          />
        </BodyRow>
      </RowGroup>
      <GroupNote>
        Once a week the worker opens Chrome on your connection and loads the page of each recipe you
        approved, so the broker sees an ordinary visit from your home address. It may search a
        generic name such as John Smith to reach the results page. It never uses your details and
        never submits a removal.
      </GroupNote>
      <GroupNote>
        The result shows as the Scan and Removal marks on Targets. Turning this off stops only site
        checks: people-search sites you have scanned are scanned again on the schedule above.
      </GroupNote>
      {toggle.isError ? (
        <Alert intent="danger" title="Could not change site checks" className="mt-3">
          {errorMessage(toggle.error)}
        </Alert>
      ) : null}
    </Section>
  );
}
