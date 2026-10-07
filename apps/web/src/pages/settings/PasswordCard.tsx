import { API_ROUTES, MIN_PASSWORD_LENGTH } from "@kickrocks/shared";
import { useState } from "react";
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
import {
  checkPassword,
  type PasswordDraft as Draft,
  EMPTY_PASSWORD_DRAFT as EMPTY,
} from "./model.js";

export function PasswordCard() {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitted, setSubmitted] = useState(false);

  const change = useApiMutation(API_ROUTES.authPassword, {
    onSuccess: () => {
      setDraft(EMPTY);
      setSubmitted(false);
      toast.success("Password changed");
    },
  });

  const errors = checkPassword(draft);
  const serverErrors = change.error?.fieldErrors ?? {};
  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (Object.keys(errors).length > 0) return;
          change.mutate({
            body: { currentPassword: draft.currentPassword, newPassword: draft.newPassword },
          });
        }}
      >
        <CardHeader
          title="Password"
          description="The password that unlocks this instance. Other signed-in browsers stay signed in."
        />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field
            label="Current password"
            className="sm:col-span-2"
            error={(submitted ? errors.currentPassword : undefined) ?? serverErrors.currentPassword}
          >
            <Input
              type="password"
              autoComplete="current-password"
              value={draft.currentPassword}
              onChange={set("currentPassword")}
            />
          </Field>
          <Field
            label="New password"
            help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            error={(submitted ? errors.newPassword : undefined) ?? serverErrors.newPassword}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.newPassword}
              onChange={set("newPassword")}
            />
          </Field>
          <Field label="Repeat the new password" error={submitted ? errors.confirm : undefined}>
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.confirm}
              onChange={set("confirm")}
            />
          </Field>
        </div>
        {change.isError && Object.keys(serverErrors).length === 0 ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not change the password">
              {errorMessage(change.error)}
            </Alert>
          </div>
        ) : null}
        <CardFooter>
          <Button type="submit" variant="primary" loading={change.isPending}>
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
