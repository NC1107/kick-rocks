import { API_ROUTES, type NotificationsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  useToast,
} from "../../../components/ui/index.js";
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
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (Object.keys(errors).length > 0) return;
          save.mutate({ body: { ntfy: patch } });
        }}
      >
        <CardHeader
          title="ntfy"
          description="Push to your phone through ntfy.sh or your own ntfy server. Pick a topic name nobody can guess."
        />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field
            label="Server"
            className="sm:col-span-2"
            error={(submitted ? errors.serverUrl : undefined) ?? serverErrors["ntfy.serverUrl"]}
          >
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={draft.serverUrl}
              onChange={(event) =>
                setDraft((current) => ({ ...current, serverUrl: event.target.value }))
              }
            />
          </Field>
          <Field
            label="Topic"
            error={(submitted ? errors.topic : undefined) ?? serverErrors["ntfy.topic"]}
          >
            <Input
              autoComplete="off"
              placeholder="kickrocks-7f3a9c"
              value={draft.topic}
              onChange={(event) =>
                setDraft((current) => ({ ...current, topic: event.target.value }))
              }
            />
          </Field>
          <Field
            label="Access token"
            optional
            help={
              ntfy?.tokenSet
                ? "A token is saved. Leave this blank to keep it."
                : "Only for a topic that needs a login."
            }
            error={serverErrors["ntfy.token"]}
          >
            <Input
              type="password"
              autoComplete="new-password"
              disabled={draft.clearToken}
              value={draft.token}
              onChange={(event) =>
                setDraft((current) => ({ ...current, token: event.target.value }))
              }
            />
          </Field>
          {ntfy?.tokenSet ? (
            <Checkbox
              className="sm:col-span-2"
              label="Remove the saved token"
              checked={draft.clearToken}
              onChange={(event) =>
                setDraft((current) => ({ ...current, clearToken: event.target.checked, token: "" }))
              }
            />
          ) : null}
        </div>
        {save.isError && Object.keys(serverErrors).length === 0 ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save ntfy">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        {test.result ? <div className="mt-4">{test.result}</div> : null}
        <CardFooter>
          {ntfy ? (
            <Button variant="ghost" onClick={() => setRemoving(true)} className="mr-auto">
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
        </CardFooter>
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
    </Card>
  );
}
