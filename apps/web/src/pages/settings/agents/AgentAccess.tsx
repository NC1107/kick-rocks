import type { SettingsView } from "@kickrocks/shared";
import { useState } from "react";
import { Button, Row, RowGroup, Section } from "../../../components/ui/index.js";
import { McpCard } from "./McpCard.js";

function describeAccess(mcp: SettingsView["mcp"]): string {
  if (!mcp.enabled) return "Off";
  return mcp.tokenSet ? "On, token set" : "On, no token yet";
}

/** MCP clients connect here. It is one quiet row until the person wants to set it up. */
export function AgentAccess({ mcp }: { mcp: SettingsView["mcp"] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Section label="Agent access">
        <RowGroup>
          <Row
            title="MCP clients"
            description={describeAccess(mcp)}
            trailing={
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {open ? "Hide" : "Set up"}
              </Button>
            }
          />
        </RowGroup>
      </Section>
      {open ? <McpCard mcp={mcp} /> : null}
    </>
  );
}
