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
            label="Check recipe pages on the real broker sites"
            description="Loads the first page of each approved recipe once a week, at the same pace as everything else."
            checked={siteChecks.enabled}
            disabled={toggle.isPending}
            onChange={(event) =>
              toggle.mutate({ body: { siteChecks: { enabled: event.target.checked } } })
            }
          />
        </BodyRow>
      </RowGroup>
      <GroupNote>
        It runs from your home connection, never searches or uses your details, and never submits a
        removal.
      </GroupNote>
      {toggle.isError ? (
        <Callout intent="danger" title="Could not change site checks" className="mt-3">
          {errorMessage(toggle.error)}
        </Callout>
      ) : null}
    </Section>
  );
}
