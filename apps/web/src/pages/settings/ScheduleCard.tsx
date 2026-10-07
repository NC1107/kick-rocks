import { API_ROUTES, type ScheduleSettings } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Field,
  Input,
  useToast,
} from "../../components/ui/index.js";
import { checkSchedule, draftOf, SCHEDULE_FIELDS, type ScheduleDraft } from "./model.js";

export function ScheduleCard({ schedule }: { schedule: ScheduleSettings }) {
  const toast = useToast();
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOf(schedule));
  const [submitted, setSubmitted] = useState(false);

  // A save elsewhere, or the reply to this one, becomes the new starting point.
  useEffect(() => setDraft(draftOf(schedule)), [schedule]);

  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: () => {
      setSubmitted(false);
      toast.success("Schedule saved");
    },
  });

  const { errors, patch } = checkSchedule(draft, schedule);
  const dirty = SCHEDULE_FIELDS.some((field) => draft[field.key] !== draftOf(schedule)[field.key]);
  const serverErrors = save.error?.fieldErrors ?? {};

  return (
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (Object.keys(errors).length > 0 || Object.keys(patch).length === 0) return;
          save.mutate({ body: { schedule: patch } });
        }}
      >
        <CardHeader
          title="Schedule"
          description="How often Kick Rocks checks for replies, follows up, and looks for listings again."
        />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {SCHEDULE_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={`${field.label} (${field.unit})`}
              help={field.help}
              error={
                (submitted ? errors[field.key] : undefined) ?? serverErrors[`schedule.${field.key}`]
              }
            >
              <Input
                type="number"
                inputMode="numeric"
                min={field.min}
                max={field.max}
                step={1}
                value={draft[field.key]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </Field>
          ))}
        </div>
        {save.isError && Object.keys(serverErrors).length === 0 ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save the schedule">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        <CardFooter>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(draftOf(schedule));
              setSubmitted(false);
            }}
          >
            Reset
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save schedule
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
