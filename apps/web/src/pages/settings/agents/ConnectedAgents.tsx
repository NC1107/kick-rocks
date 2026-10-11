import type { AgentRow } from "@kickrocks/shared";
import { errorMessage, useAgents } from "../../../api/index.js";
import {
  Button,
  Callout,
  Row,
  RowGroup,
  Section,
  SkeletonText,
} from "../../../components/ui/index.js";
import { useNow } from "../../../lib/use-now.js";
import {
  modelLine,
  NO_AGENTS_TEXT,
  presenceLine,
  presenceWord,
  sendingLine,
} from "../../assign/model.js";
import { BodyRow, GroupNote, Value } from "../rows.js";

function describe(row: AgentRow, now: number): string {
  const parts = [
    row.kind === "model" ? modelLine(row) : "MCP client",
    presenceLine(row, now),
    sendingLine(row),
  ];
  return parts.filter(Boolean).join(". ");
}

/** The agent workers and MCP clients that have called in lately, the ones a task can be assigned to. */
export function ConnectedAgents() {
  const agents = useAgents({});
  const now = useNow();

  if (agents.isPending) {
    return (
      <Section label="Connected agents">
        <RowGroup aria-busy="true">
          <BodyRow>
            <span className="sr-only">Loading connected agents</span>
            <SkeletonText lines={2} />
          </BodyRow>
        </RowGroup>
      </Section>
    );
  }
  if (agents.isError) {
    return (
      <Callout
        intent="danger"
        title="Could not load the connected agents"
        action={
          <Button size="sm" onClick={() => agents.refetch()}>
            Try again
          </Button>
        }
      >
        {errorMessage(agents.error)}
      </Callout>
    );
  }
  const rows = agents.data.agents;
  return (
    <Section label="Connected agents" count={rows.length}>
      <RowGroup>
        {rows.length === 0 ? (
          <BodyRow>
            <p className="text-meta text-ink-2">
              {NO_AGENTS_TEXT} Set up an agent worker or an MCP client below.
            </p>
          </BodyRow>
        ) : (
          rows.map((row) => (
            <Row
              key={`${row.kind}:${row.workerId}`}
              title={<span className="font-mono">{row.workerId}</span>}
              description={describe(row, now)}
              wrapDescription
              trailing={<Value>{row.online && row.busy ? "Busy" : presenceWord(row)}</Value>}
            />
          ))
        )}
      </RowGroup>
      <GroupNote>
        Agents seen in the last 7 days. A task can be assigned to any of them from its request.
      </GroupNote>
    </Section>
  );
}
