import { API_ROUTES, type NotificationsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  Callout,
  Checkbox,
  ConfirmDialog,
  Input,
  RowGroup,
  Section,
  useToast,
} from "../../../components/ui/index.js";
import { BodyRow, FieldRow, GroupFooter } from "../rows.js";
import { checkNtfy, type NtfyDraft, ntfyDirty, ntfyDraftOf } from "./model.js";
import { useChannelTest } from "./useChannelTest.js";

export function NtfyCard({ ntfy }: { ntfy: NotificationsView["ntfy"] }) {
  const toast = useToast();
  const [draft, setDraft] = useState<NtfyDraft>(() => ntfyDraftOf(ntfy));
  const [submitted, setSubmitted] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => setDraft(ntfyDraftOf(ntfy)), [ntfy]);

  const save = useApiMutation(API_ROUTES.notificationsPatch, {
    invalidates: [API_ROUTES.notificationsGet],
    onSuccess: (_view, variables) => {
      setSubmitted(false);
      setRemoving(false);
      toast.success(variables.body.ntfy === null ? "ntfy removed" : "ntfy saved");
    },
    onError: () => setRemoving(false),
  });

  const dirty = ntfyDirty(draft, ntfy);
  const { errors, patch } = checkNtfy(draft);
  const serverErrors = save.error?.fieldErrors ?? {};
  const test = useChannelTest("ntfy", ntfy === null || dirty);

  return (
    <>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (Object.keys(errors).length > 0) return;
          save.mutate({ body: { ntfy: patch } });
        }}
      >
        <Section label="ntfy">
          <RowGroup>
            <FieldRow
              label="Server"
              error={(submitted ? errors.serverUrl : undefined) ?? serverErrors["ntfy.serverUrl"]}
            >
              <Input
                mono
                type="url"
                inputMode="url"
                autoComplete="off"
                value={draft.serverUrl}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, serverUrl: event.target.value }))
                }
              />
            </FieldRow>
            <FieldRow
              label="Topic"
              help="Pick a name nobody can guess."
              error={(submitted ? errors.topic : undefined) ?? serverErrors["ntfy.topic"]}
            >
              <Input
                mono
                autoComplete="off"
                placeholder="kickrocks-7f3a9c"
                value={draft.topic}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, topic: event.target.value }))
                }
              />
            </FieldRow>
            <FieldRow
              label="Access token"
              optional
              help={ntfy?.tokenSet ? "A token is saved. Leave this blank to keep it." : undefined}
              error={serverErrors["ntfy.token"]}
            >
              <Input
                mono
                type="password"
                autoComplete="new-password"
                disabled={draft.clearToken}
                value={draft.token}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, token: event.target.value }))
                }
              />
            </FieldRow>
            {ntfy?.tokenSet ? (
              <BodyRow>
                <Checkbox
                  label="Remove the saved token"
                  checked={draft.clearToken}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      clearToken: event.target.checked,
                      token: "",
                    }))
                  }
                />
              </BodyRow>
            ) : null}
            <GroupFooter>
              {ntfy ? (
                <Button variant="danger" onClick={() => setRemoving(true)} className="mr-auto">
                  Remove
                </Button>
              ) : null}
              {test.button}
              <Button
                type="submit"
                variant="primary"
                loading={save.isPending && !removing}
                disabled={!dirty}
              >
                Save ntfy
              </Button>
            </GroupFooter>
          </RowGroup>
          {save.isError && Object.keys(serverErrors).length === 0 ? (
            <Callout intent="danger" title="Could not save ntfy" className="mt-3">
              {errorMessage(save.error)}
            </Callout>
          ) : null}
          {test.result ? <div className="mt-3">{test.result}</div> : null}
        </Section>
      </form>

      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove ntfy?"
        description="Kick Rocks stops sending push notifications to this topic."
        confirmLabel="Remove"
        destructive
        loading={save.isPending}
        onConfirm={() => save.mutate({ body: { ntfy: null } })}
      />
    </>
  );
}
