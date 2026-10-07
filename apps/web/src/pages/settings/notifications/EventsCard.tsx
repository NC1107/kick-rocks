import {
  API_ROUTES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
  type NotificationsView,
} from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  Callout,
  Checkbox,
  Input,
  RowGroup,
  Section,
  useToast,
} from "../../../components/ui/index.js";
import { BodyRow, FieldRow, GroupFooter, GroupNote } from "../rows.js";
import { checkMaxPerHour } from "./model.js";

const CATEGORIES = Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[];

export function EventsCard({
  categories,
  maxPerHour,
}: Pick<NotificationsView, "categories" | "maxPerHour">) {
  const toast = useToast();
  const [chosen, setChosen] = useState<readonly NotificationCategory[]>(categories);
  const [limit, setLimit] = useState(String(maxPerHour));
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setChosen(categories);
    setLimit(String(maxPerHour));
  }, [categories, maxPerHour]);

  const save = useApiMutation(API_ROUTES.notificationsPatch, {
    invalidates: [API_ROUTES.notificationsGet],
    onSuccess: () => {
      setSubmitted(false);
      toast.success("Notification settings saved");
    },
  });

  const checked = checkMaxPerHour(limit);
  const dirty =
    limit.trim() !== String(maxPerHour) ||
    CATEGORIES.some((category) => chosen.includes(category) !== categories.includes(category));

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (checked.value === undefined) return;
        save.mutate({
          body: {
            categories: CATEGORIES.filter((category) => chosen.includes(category)),
            maxPerHour: checked.value,
          },
        });
      }}
    >
      <Section label="What to tell you about">
        <RowGroup>
          <fieldset className="m-0 min-w-0 divide-y divide-line border-0 p-0">
            <legend className="sr-only">Send a notification when</legend>
            {CATEGORIES.map((category) => (
              <BodyRow key={category}>
                <Checkbox
                  label={NOTIFICATION_CATEGORY_LABELS[category]}
                  checked={chosen.includes(category)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, category]
                        : current.filter((item) => item !== category),
                    )
                  }
                />
              </BodyRow>
            ))}
          </fieldset>
          <FieldRow
            label="Pushes per hour, at most"
            help="Held-back ones go out together."
            error={submitted ? checked.error : undefined}
          >
            <Input
              mono
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              unit="/h"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </FieldRow>
          <GroupFooter>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
              Save
            </Button>
          </GroupFooter>
        </RowGroup>
        <GroupNote>
          A push gives a count and a link here. It never names a target or a person.
        </GroupNote>
        {save.isError ? (
          <Callout intent="danger" title="Could not save" className="mt-3">
            {errorMessage(save.error)}
          </Callout>
        ) : null}
      </Section>
    </form>
  );
}
