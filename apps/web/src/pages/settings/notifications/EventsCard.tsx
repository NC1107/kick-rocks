import {
  API_ROUTES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
  type NotificationsView,
} from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Checkbox,
  Field,
  Input,
  useToast,
} from "../../../components/ui/index.js";
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
    <Card>
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
        <CardHeader
          title="What to tell you about"
          description="A push says how many things need you and links to this app. It never names a broker, a person, or an address."
        />
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Send a notification when</legend>
          {CATEGORIES.map((category) => (
            <Checkbox
              key={category}
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
          ))}
        </fieldset>
        <div className="mt-5 max-w-xs">
          <Field
            label="Pushes per hour, at most"
            help="Anything held back goes out together in the next message."
            error={submitted ? checked.error : undefined}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </Field>
        </div>
        {save.isError ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        <CardFooter>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
