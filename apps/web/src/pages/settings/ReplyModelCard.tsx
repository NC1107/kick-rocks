import { API_ROUTES, type ReplyModelView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, routeUrl, useApiMutation } from "../../api/index.js";
import { Button, Callout, Input, RowGroup, Section, useToast } from "../../components/ui/index.js";
import { bandText, precisionText, stateText, thresholdText } from "./reply-model.js";
import { ActionRow, BodyRow, FactRow, FieldRow, GroupFooter, GroupNote } from "./rows.js";

export function ReplyModelCard({ model }: { model: ReplyModelView }) {
  const toast = useToast();
  const [share, setShare] = useState(String(model.spotCheckPercent));
  useEffect(() => setShare(String(model.spotCheckPercent)), [model.spotCheckPercent]);

  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (_view, variables) =>
      toast.success(
        variables.body.replyModel?.resume ? "Applying answers again" : "Reply model saved",
      ),
  });

  const parsed = Number(share);
  const valid = share.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  const dirty = valid && parsed !== model.spotCheckPercent;
  const used = model.check.bands.filter((band) => band.answers > 0);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) save.mutate({ body: { replyModel: { spotCheckPercent: parsed } } });
      }}
    >
      <Section label="Reply model">
        {model.paused ? (
          <Callout
            intent="warning"
            title="Answers are not being applied"
            className="mb-3"
            action={
              <Button
                size="sm"
                loading={save.isPending}
                onClick={() => save.mutate({ body: { replyModel: { resume: true } } })}
              >
                Apply again
              </Button>
            }
          >
            {model.paused.reason}. They wait in Review until you resume.
          </Callout>
        ) : null}
        <RowGroup>
          <FactRow label="State" mono={false}>
            {stateText(model.status)}
          </FactRow>
          <FactRow label="Applies answers at">{thresholdText(model)}</FactRow>
          <FieldRow
            label="Spot checks"
            help="The share of sure answers held in Review so you can check them. 0 turns it off."
            error={valid ? undefined : "Enter a whole number from 0 to 100"}
          >
            <Input
              mono
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              unit="%"
              value={share}
              onChange={(event) => setShare(event.target.value)}
            />
          </FieldRow>
          <FactRow label="Spot checks that agreed">{precisionText(model.check)}</FactRow>
          {used.length > 0 ? (
            <BodyRow>
              <p className="mb-1 text-meta text-ink-3">Your answers, by how sure the model was</p>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {used.map((band) => {
                  const text = bandText(band);
                  return (
                    <li
                      key={band.from}
                      className="flex justify-between gap-4 font-mono text-meta tabular-nums text-ink-2"
                    >
                      <span>{text.range}</span>
                      <span>{text.agreed}</span>
                    </li>
                  );
                })}
              </ul>
            </BodyRow>
          ) : null}
          <ActionRow
            title="Labelled replies"
            description="Download the replies you classified, with the model's guess, to train a later model. Nothing leaves this server unless you do this."
          >
            <a
              href={routeUrl(API_ROUTES.replyModelLabels)}
              download
              className="inline-flex h-control items-center rounded-sm border border-line-strong px-3.5 text-ui font-medium text-ink hover:bg-hover"
            >
              Download
            </a>
          </ActionRow>
          <GroupFooter>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
              Save reply model
            </Button>
          </GroupFooter>
        </RowGroup>
        <GroupNote>
          A small model that runs on this machine reads the replies the rules cannot place. Its
          answer is only a suggestion that Review starts from, and it never acts on its own. Nothing
          it reads is sent anywhere.
        </GroupNote>
        {save.isError ? (
          <Callout intent="danger" title="Could not save the reply model" className="mt-3">
            {errorMessage(save.error)}
          </Callout>
        ) : null}
      </Section>
    </form>
  );
}
