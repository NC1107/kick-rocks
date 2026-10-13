import type { AgentRow } from "@kickrocks/shared";
import { errorMessage, useAgents } from "../../../api/index.js";
import { Button, Callout, Row, RowGroup, Section } from "../../../components/ui/index.js";
import { useNow } from "../../../lib/use-now.js";
import { modelLine, presenceLine, presenceWord, sendingLine } from "../../assign/model.js";
import { Value } from "../rows.js";

function describe(row: AgentRow, now: number): string {
  const parts = [
    row.kind === "model" ? modelLine(row) : "MCP client",
    presenceLine(row, now),
    sendingLine(row),
  ];
  return parts.filter(Boolean).join(". ");
}

/** The agent workers and MCP clients that have called in lately. */
export function ConnectedAgents() {
  const agents = useAgents({});
  const now = useNow();

  if (agents.isPending) {
    return <span className="sr-only">Loading connected agents</span>;
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
  if (rows.length === 0) return <p className="mt-3 text-meta text-ink-3">None connected</p>;
  return (
    <Section label="Connected agents" count={rows.length}>
      <RowGroup>
        {rows.map((row) => (
          <Row
            key={`${row.kind}:${row.workerId}`}
            title={<span className="font-mono">{row.workerId}</span>}
            description={describe(row, now)}
            wrapDescription
            trailing={<Value>{row.online && row.busy ? "Busy" : presenceWord(row)}</Value>}
          />
        ))}
      </RowGroup>
    </Section>
  );
}
