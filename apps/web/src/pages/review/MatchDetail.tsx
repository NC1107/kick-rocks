import type { Match } from "@kickrocks/shared";
import {
  Button,
  type DescriptionItem,
  DescriptionList,
  EntityLink,
  ExternalLinkText,
  MonoEmails,
} from "../../components/ui/index.js";
import { DetailFrame } from "./DetailFrame.js";
import { useMatchDecision } from "./match-decision.js";

function facts(fields: Match["fields"], recordUrl: string): DescriptionItem[] {
  const list = (term: string, values: readonly string[] | undefined, separator = ", ") =>
    values && values.length > 0 ? [{ term, description: values.join(separator) }] : [];
  return [
    ...list("Locations", fields.locations, "; "),
    ...list("Relatives", fields.relatives),
    ...list("Phones", fields.phones),
    ...(fields.emails && fields.emails.length > 0
      ? [{ term: "Emails", description: <MonoEmails text={fields.emails.join(", ")} /> }]
      : []),
    {
      term: "Record",
      description: (
        <ExternalLinkText href={recordUrl} className="break-all font-mono text-meta">
          {recordUrl}
        </ExternalLinkText>
      ),
    },
  ];
}

export function MatchDetail({ match }: { match: Match }) {
  const decision = useMatchDecision(match);
  const { fields } = match;

  return (
    <>
      <DetailFrame
        label={`${fields.name} on ${match.targetName}`}
        title={fields.name}
        meta={
          <>
            Found on{" "}
            <EntityLink to={{ kind: "target", id: match.targetId, name: match.targetName }} />
            {fields.age !== undefined ? `, age ${fields.age}` : ""}
          </>
        }
        error={decision.error}
        footer={
          <>
            <Button variant="primary" onClick={decision.askMine} disabled={decision.deciding}>
              This is me
            </Button>
            <Button
              loading={decision.decidingNotMine}
              disabled={decision.deciding}
              onClick={decision.notMine}
            >
              Not me
            </Button>
          </>
        }
      >
        <DescriptionList items={facts(fields, match.recordUrl)} />
      </DetailFrame>
      {decision.dialog}
    </>
  );
}
