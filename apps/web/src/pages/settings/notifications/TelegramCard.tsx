import { API_ROUTES, type NotificationsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  useToast,
} from "../../../components/ui/index.js";
import { checkTelegram, type TelegramDraft, telegramDirty, telegramDraftOf } from "./model.js";
import { useChannelTest } from "./useChannelTest.js";

export function TelegramCard({ telegram }: { telegram: NotificationsView["telegram"] }) {
  const toast = useToast();
  const [draft, setDraft] = useState<TelegramDraft>(() => telegramDraftOf(telegram));
  const [submitted, setSubmitted] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => setDraft(telegramDraftOf(telegram)), [telegram]);

  const save = useApiMutation(API_ROUTES.notificationsPatch, {
    invalidates: [API_ROUTES.notificationsGet],
    onSuccess: (_view, variables) => {
      setSubmitted(false);
      setRemoving(false);
      toast.success(variables.body.telegram === null ? "Telegram removed" : "Telegram saved");
    },
    onError: () => setRemoving(false),
  });

  const dirty = telegramDirty(draft, telegram);
  const { errors, patch } = checkTelegram(draft, telegram);
  const serverErrors = save.error?.fieldErrors ?? {};
  const test = useChannelTest("telegram", telegram === null || dirty);

  return (
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (Object.keys(errors).length > 0) return;
          save.mutate({ body: { telegram: patch } });
        }}
      >
        <CardHeader
          title="Telegram"
          description="Create a bot with BotFather, send it a message, then enter its token and the id of your chat with it."
        />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field
            label="Bot token"
            help={
              telegram?.botTokenSet
                ? "A token is saved. Leave this blank to keep it."
                : "From BotFather, like 123456:ABC-DEF."
            }
            error={(submitted ? errors.botToken : undefined) ?? serverErrors["telegram.botToken"]}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.botToken}
              onChange={(event) =>
                setDraft((current) => ({ ...current, botToken: event.target.value }))
              }
            />
          </Field>
          <Field
            label="Chat id"
            error={(submitted ? errors.chatId : undefined) ?? serverErrors["telegram.chatId"]}
          >
            <Input
              autoComplete="off"
              inputMode="text"
              placeholder="123456789"
              value={draft.chatId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, chatId: event.target.value }))
              }
            />
          </Field>
        </div>
        {save.isError && Object.keys(serverErrors).length === 0 ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save Telegram">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        {test.result ? <div className="mt-4">{test.result}</div> : null}
        <CardFooter>
          {telegram ? (
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
            Save Telegram
          </Button>
        </CardFooter>
      </form>

      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove Telegram?"
        description="Kick Rocks stops messaging this chat."
        confirmLabel="Remove"
        destructive
        loading={save.isPending}
        onConfirm={() => save.mutate({ body: { telegram: null } })}
      />
    </Card>
  );
}
