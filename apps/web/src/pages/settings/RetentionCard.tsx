import { API_ROUTES, type RetentionSettings } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Field,
  Select,
  useToast,
} from "../../components/ui/index.js";
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
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) save.mutate({ body: { retention: patch } });
        }}
      >
        <CardHeader
          title="Retention"
          description="How long Kick Rocks keeps the bulky and sensitive parts of what it stores. Saving a shorter window deletes what is already older than it, and the database file is compacted so the space is not left holding it."
        />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {RETENTION_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} help={field.help}>
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
            </Field>
          ))}
        </div>
        {save.isError ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save retention">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        <CardFooter>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(retentionDraftOf(retention))}
          >
            Reset
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save retention
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
