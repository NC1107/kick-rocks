import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Checkbox,
  InlineError,
  RowGroup,
  Section,
  useToast,
} from "../../../components/ui/index.js";
import { BodyRow } from "../rows.js";

export function UnreviewedSitesCard({ agent }: { agent: SettingsView["agent"] }) {
  const toast = useToast();
  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (view) =>
      toast.success(
        view.agent.takeUnreviewed
          ? "The agent worker will take unreviewed targets"
          : "The agent worker will leave unreviewed targets to you",
      ),
  });
  return (
    <Section label="Agent worker">
      <RowGroup>
        <BodyRow className="flex flex-col gap-2">
          <Checkbox
            label="Take unreviewed targets"
            description="Rejected ones still wait for you."
            checked={agent.takeUnreviewed}
            disabled={save.isPending}
            onChange={(event) =>
              save.mutate({ body: { agent: { takeUnreviewed: event.target.checked } } })
            }
          />
          {save.isError ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        </BodyRow>
      </RowGroup>
    </Section>
  );
}
