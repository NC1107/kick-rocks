import { API_ROUTES, type RetentionSettings } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Button, Callout, RowGroup, Section, Select, useToast } from "../../components/ui/index.js";
import {
  clearsData,
  describeDays,
  KEEP_FOREVER,
  RETENTION_FIELDS,
  type RetentionDraft,
  retentionChoices,
  retentionDraftOf,
  retentionPatchOf,
} from "./model.js";
import { FieldRow, GroupFooter, GroupNote } from "./rows.js";

export function RetentionCard({ retention }: { retention: RetentionSettings }) {
  const toast = useToast();
  const [draft, setDraft] = useState<RetentionDraft>(() => retentionDraftOf(retention));

  useEffect(() => setDraft(retentionDraftOf(retention)), [retention]);

  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (_data, variables) =>
      toast.success(
        "Retention saved",
        clearsData(variables.body.retention ?? {}, retention)
          ? "Older data was cleared right away."
          : undefined,
      ),
  });

  const patch = retentionPatchOf(draft, retention);
  const dirty = Object.keys(patch).length > 0;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) save.mutate({ body: { retention: patch } });
      }}
    >
      <Section label="Retention">
        <RowGroup>
          {RETENTION_FIELDS.map((field) => (
            <FieldRow
              key={field.key}
              label={field.label}
              {...(field.help ? { help: field.help } : {})}
            >
              <Select
                value={draft[field.key]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
              >
                {retentionChoices(field, retention[field.key]).map((days) => (
                  <option key={days} value={days}>
                    {describeDays(days)}
                  </option>
                ))}
                <option value={KEEP_FOREVER}>Until I delete them</option>
              </Select>
            </FieldRow>
          ))}
          <GroupFooter>
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => setDraft(retentionDraftOf(retention))}
            >
              Reset
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
              Save retention
            </Button>
          </GroupFooter>
        </RowGroup>
        <GroupNote>A shorter window deletes older data when you save.</GroupNote>
        {save.isError ? (
          <Callout intent="danger" title="Could not save retention" className="mt-3">
            {errorMessage(save.error)}
          </Callout>
        ) : null}
      </Section>
    </form>
  );
}
