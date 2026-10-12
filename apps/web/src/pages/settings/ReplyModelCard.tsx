import { API_ROUTES, type ReplyModelView } from "@kickrocks/shared";
import { routeUrl } from "../../api/index.js";
import { RowGroup, Section } from "../../components/ui/index.js";
import { bandText, stateText } from "./reply-model.js";
import { ActionRow, BodyRow, FactRow, GroupNote } from "./rows.js";

export function ReplyModelCard({ model }: { model: ReplyModelView }) {
  const used = model.bands.filter((band) => band.answers > 0);

  return (
    <Section label="Reply model">
      <RowGroup>
        <FactRow label="State" mono={false}>
          {stateText(model.status)}
        </FactRow>
        <FactRow label="Use" mono={false}>
          Suggestions only
        </FactRow>
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
          description="Download classified replies with model guesses; nothing leaves this server otherwise."
        >
          <a
            href={routeUrl(API_ROUTES.replyModelLabels)}
            download
            className="inline-flex h-control items-center rounded-sm border border-line-strong px-3.5 text-ui font-medium text-ink hover:bg-hover"
          >
            Download
          </a>
        </ActionRow>
      </RowGroup>
      <GroupNote detail="A small model on this machine reads the replies the rules cannot place. Nothing it reads is sent anywhere.">
        Local model suggests a reply type; never acts, never sends data.
      </GroupNote>
    </Section>
  );
}
