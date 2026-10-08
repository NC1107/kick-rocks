import { API_ROUTES, type LlmSettingsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  Input,
  RowGroup,
  Section,
  useToast,
} from "../../components/ui/index.js";
import { checkLlm, type LlmDraft } from "./model.js";
import { FieldRow, GroupFooter, GroupNote } from "./rows.js";

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
    <>
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
        <Section label="Language model">
          <RowGroup>
            <FieldRow
              label="Base URL"
              error={(submitted ? errors.baseUrl : undefined) ?? serverErrors["llm.baseUrl"]}
            >
              <Input
                mono
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="http://localhost:11434/v1"
                value={draft.baseUrl}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, baseUrl: event.target.value }))
                }
              />
            </FieldRow>
            <FieldRow
              label="Model"
              error={(submitted ? errors.model : undefined) ?? serverErrors["llm.model"]}
            >
              <Input
                mono
                autoComplete="off"
                placeholder="llama3.1"
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, model: event.target.value }))
                }
              />
            </FieldRow>
            <FieldRow
              label="API key"
              optional
              help={llm?.apiKeySet ? "A key is saved. Leave this blank to keep it." : undefined}
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
            </FieldRow>
            <GroupFooter>
              {llm ? (
                <Button variant="danger" onClick={() => setRemoving(true)} className="mr-auto">
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
            </GroupFooter>
          </RowGroup>
          <GroupNote>
            Classifies replies the rules cannot place. Any OpenAI-compatible endpoint works.
          </GroupNote>
          {save.isError && Object.keys(serverErrors).length === 0 ? (
            <Callout intent="danger" title="Could not save the language model" className="mt-3">
              {errorMessage(save.error)}
            </Callout>
          ) : null}
        </Section>
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
    </>
  );
}
