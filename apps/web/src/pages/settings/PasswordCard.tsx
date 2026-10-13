import { API_ROUTES, MIN_PASSWORD_LENGTH } from "@kickrocks/shared";
import { useId, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Button, Callout, Input, RowGroup, Section, useToast } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import {
  checkPassword,
  type PasswordDraft as Draft,
  EMPTY_PASSWORD_DRAFT as EMPTY,
} from "./model.js";
import { FieldRow, GroupFooter } from "./rows.js";

export function PasswordCard() {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [open, setOpen] = useState(false);
  const panel = useId();

  const change = useApiMutation(API_ROUTES.authPassword, {
    onSuccess: () => {
      setDraft(EMPTY);
      setSubmitted(false);
      setOpen(false);
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
      <Section label="Account">
        <RowGroup>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? panel : undefined}
            onClick={() => setOpen(!open)}
            className="marked flex min-h-row w-full items-center justify-between gap-3 px-3.5 py-2 text-left transition-colors duration-100 hover:bg-hover focus-visible:-outline-offset-2"
          >
            <span className="text-ui font-medium text-ink">Password</span>
            <span className={cn("text-ui", open ? "text-ink-2" : "text-accent-text")}>
              {open ? "Cancel" : "Change"}
            </span>
          </button>
          {open ? (
            <div id={panel} className="divide-y divide-line">
              <FieldRow
                label="Current password"
                error={
                  (submitted ? errors.currentPassword : undefined) ?? serverErrors.currentPassword
                }
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
              <FieldRow
                label="Repeat the new password"
                error={submitted ? errors.confirm : undefined}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={draft.confirm}
                  onChange={set("confirm")}
                />
              </FieldRow>
              <GroupFooter>
                <Button
                  type="submit"
                  variant="primary"
                  loading={change.isPending}
                  disabled={!filled}
                >
                  Save
                </Button>
              </GroupFooter>
            </div>
          ) : null}
        </RowGroup>
        {change.isError && Object.keys(serverErrors).length === 0 ? (
          <Callout intent="danger" title="Could not change the password" className="mt-3">
            {errorMessage(change.error)}
          </Callout>
        ) : null}
      </Section>
    </form>
  );
}
