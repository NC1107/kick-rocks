import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Card, CardHeader, Checkbox, useToast } from "../../components/ui/index.js";

export function SiteChecksCard({ siteChecks }: { siteChecks: SettingsView["siteChecks"] }) {
  const toast = useToast();
  const toggle = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (view) =>
      toast.success(view.siteChecks.enabled ? "Site checks turned on" : "Site checks turned off"),
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader
        title="Site checks"
        description="Once a week the worker can open the entry page of each recipe you approved, to notice a broker's form changing before a real removal fails on it."
      />
      <div className="flex flex-col gap-4">
        <Checkbox
          label="Check recipe pages on the real broker sites"
          description="Off by default. Nothing is checked until you turn this on."
          checked={siteChecks.enabled}
          disabled={toggle.isPending}
          onChange={(event) =>
            toggle.mutate({ body: { siteChecks: { enabled: event.target.checked } } })
          }
        />
        <ul className="list-disc space-y-1.5 pl-5 text-base text-ink-muted">
          <li>
            The worker opens Chrome on your connection and loads the broker's page, so the broker
            sees an ordinary visit from your home address.
          </li>
          <li>
            It only looks for the form fields the recipe expects. It types nothing, submits nothing,
            and sends none of your details.
          </li>
          <li>
            The result shows as the Scan and Removal badges on Targets. Turn this off and no site is
            visited on its own; scans and removals you start still run.
          </li>
        </ul>
      </div>
    </Card>
  );
}
