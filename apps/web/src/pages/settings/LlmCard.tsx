import { API_ROUTES, type LlmSettingsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
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
} from "../../components/ui/index.js";
import { checkLlm, type LlmDraft } from "./model.js";

function draftOf(llm: LlmSettingsView | null): LlmDraft {
  return { baseUrl: llm?.baseUrl ?? "", model: llm?.model ?? "", apiKey: "" };
}

export function LlmCard({ llm }: { llm: LlmSettingsView | null }) {
  const toast = useToast();
  const [draft, setDraft] = useState<LlmDraft>(() => draftOf(llm));
  const [submitted, setSubmitted] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => setDraft(draftOf(llm)), [llm]);

  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (_view, variables) => {
      setSubmitted(false);
      setRemoving(false);
      toast.success(
        variables.body.llm === null ? "Language model removed" : "Language model saved",
      );
    },
    onError: () => setRemoving(false),
  });

  const errors = checkLlm(draft);
  const saved = draftOf(llm);
  const dirty =
    draft.baseUrl.trim() !== saved.baseUrl ||
    draft.model.trim() !== saved.model ||
    draft.apiKey !== "";
  const serverErrors = save.error?.fieldErrors ?? {};

  return (
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (Object.keys(errors).length > 0) return;
          save.mutate({
            body: {
              llm: {
                baseUrl: draft.baseUrl.trim(),
                model: draft.model.trim(),
                ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
              },
            },
          });
        }}
      >
        <CardHeader
          title="Language model"
          description="Optional. Kick Rocks asks it to classify replies its own rules cannot. Any OpenAI-compatible endpoint works, such as Ollama on this machine."
        />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field
            label="Base URL"
            className="sm:col-span-2"
            error={(submitted ? errors.baseUrl : undefined) ?? serverErrors["llm.baseUrl"]}
          >
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="http://localhost:11434/v1"
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
          </Field>
          <Field
            label="Model"
            error={(submitted ? errors.model : undefined) ?? serverErrors["llm.model"]}
          >
            <Input
              autoComplete="off"
              placeholder="llama3.1"
              value={draft.model}
              onChange={(event) =>
                setDraft((current) => ({ ...current, model: event.target.value }))
              }
            />
          </Field>
          <Field
            label="API key"
            optional
            help={
              llm?.apiKeySet
                ? "A key is saved. Leave this blank to keep it."
                : "Local models usually need none."
            }
            error={serverErrors["llm.apiKey"]}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.apiKey}
              onChange={(event) =>
                setDraft((current) => ({ ...current, apiKey: event.target.value }))
              }
            />
          </Field>
        </div>
        {save.isError && Object.keys(serverErrors).length === 0 ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save the language model">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        <CardFooter>
          {llm ? (
            <Button variant="ghost" onClick={() => setRemoving(true)} className="mr-auto">
              Remove
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending && !removing}
            disabled={!dirty}
          >
            Save language model
          </Button>
        </CardFooter>
      </form>

      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove the language model?"
        description="Replies the rules cannot place will wait in Review instead."
        confirmLabel="Remove"
        destructive
        loading={save.isPending}
        onConfirm={() => save.mutate({ body: { llm: null } })}
      />
    </Card>
  );
}
