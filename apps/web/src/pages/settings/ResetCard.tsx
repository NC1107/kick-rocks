import { API_ROUTES, RESET_CONFIRMATION } from "@kickrocks/shared";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  RowGroup,
  Section,
  useToast,
} from "../../components/ui/index.js";
import { ActionRow } from "./rows.js";

export function ResetCard() {
  const toast = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const reset = useApiMutation(API_ROUTES.settingsReset, {
    onSuccess: async () => {
      setOpen(false);
      setTyped("");
      // Every cached answer is about data that no longer exists.
      await client.invalidateQueries();
      toast.success("Everything was deleted", "Kick Rocks is empty. Add a profile to start again.");
      navigate("/profiles");
    },
  });

  const close = () => {
    if (reset.isPending) return;
    setOpen(false);
    setTyped("");
    reset.reset();
  };
  const confirmed = typed.trim() === RESET_CONFIRMATION;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (confirmed) reset.mutate({ body: { confirm: RESET_CONFIRMATION } });
  };

  return (
    <Section label="Danger zone">
      <RowGroup>
        <ActionRow
          title="Delete all data"
          description="Removes every profile and everything about it, stops running tasks, and clears your settings, language model key, agent token, and notification tokens and schedule. Your sign-in password and the broker list stay. This cannot be undone, and requests already sent cannot be recalled."
        >
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete all data
          </Button>
        </ActionRow>
      </RowGroup>
      <Dialog
        open={open}
        onClose={close}
        dismissible={!reset.isPending}
        size="sm"
        title="Delete all data?"
        description="Removes every profile and everything about it, stops running tasks, and clears settings, keys, and tokens. Your sign-in password and the target list stay. Requests already sent cannot be recalled."
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={reset.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="reset-all-form"
              variant="danger-solid"
              disabled={!confirmed}
              loading={reset.isPending}
            >
              Delete all data
            </Button>
          </>
        }
      >
        <form id="reset-all-form" noValidate onSubmit={submit}>
          <Field label={`Type "${RESET_CONFIRMATION}" to confirm`}>
            <Input
              value={typed}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>
        </form>
        {reset.error ? (
          <Alert intent="danger" title="Could not delete" className="mt-3">
            {errorMessage(reset.error)}
          </Alert>
        ) : null}
      </Dialog>
    </Section>
  );
}
