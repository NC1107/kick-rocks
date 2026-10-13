import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Callout, Checkbox, RowGroup, Section, useToast } from "../../components/ui/index.js";
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
            label="Check recipes on live sites"
            description="Weekly check of recipe pages"
            checked={siteChecks.enabled}
            disabled={toggle.isPending}
            onChange={(event) =>
              toggle.mutate({ body: { siteChecks: { enabled: event.target.checked } } })
            }
          />
        </BodyRow>
      </RowGroup>
      <GroupNote>Read-only, from your IP</GroupNote>
      {toggle.isError ? (
        <Callout intent="danger" title="Could not change site checks" className="mt-3">
          {errorMessage(toggle.error)}
        </Callout>
      ) : null}
    </Section>
  );
}
