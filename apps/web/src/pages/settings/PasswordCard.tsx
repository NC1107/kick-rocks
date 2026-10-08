import { API_ROUTES, MIN_PASSWORD_LENGTH } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Alert, Button, Input, RowGroup, Section, useToast } from "../../components/ui/index.js";
import {
  checkPassword,
  type PasswordDraft as Draft,
  EMPTY_PASSWORD_DRAFT as EMPTY,
} from "./model.js";
import { FieldRow, GroupFooter, GroupNote } from "./rows.js";

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

  const filled = Object.values(draft).every((value) => value !== "");
  const errors = checkPassword(draft);
  const serverErrors = change.error?.fieldErrors ?? {};
  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
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
      <Section label="Password">
        <RowGroup>
          <FieldRow
            label="Current password"
            error={(submitted ? errors.currentPassword : undefined) ?? serverErrors.currentPassword}
          >
            <Input
              type="password"
              autoComplete="current-password"
              value={draft.currentPassword}
              onChange={set("currentPassword")}
            />
          </FieldRow>
          <FieldRow
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
          </FieldRow>
          <FieldRow label="Repeat the new password" error={submitted ? errors.confirm : undefined}>
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.confirm}
              onChange={set("confirm")}
            />
          </FieldRow>
          <GroupFooter>
            <Button type="submit" variant="primary" loading={change.isPending} disabled={!filled}>
              Change password
            </Button>
          </GroupFooter>
        </RowGroup>
        <GroupNote>
          The password does not encrypt your data. That uses a key stored next to the database, so
          back up the whole kickrocks-data volume, key included. docs/self-hosting.md has the
          commands.
        </GroupNote>
        {change.isError && Object.keys(serverErrors).length === 0 ? (
          <Alert intent="danger" title="Could not change the password" className="mt-3">
            {errorMessage(change.error)}
          </Alert>
        ) : null}
      </Section>
    </form>
  );
}
