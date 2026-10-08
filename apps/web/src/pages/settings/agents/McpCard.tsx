import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  Callout,
  Checkbox,
  CodeBlock,
  ConfirmDialog,
  CopyButton,
  InlineError,
  Row,
  RowGroup,
  Section,
  useToast,
} from "../../../components/ui/index.js";
import { MCP_TOKEN_PLACEHOLDER, mcpClientConfig } from "../model.js";
import { BodyRow, GroupFooter, Value } from "../rows.js";

export function McpCard({ mcp }: { mcp: SettingsView["mcp"] }) {
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const toggle = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (view) =>
      toast.success(view.mcp.enabled ? "Agent access turned on" : "Agent access turned off"),
  });
  const create = useApiMutation(API_ROUTES.settingsMcpToken, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (result) => {
      setConfirming(false);
      setToken(result.token);
      toast.success("Token created");
    },
    onError: () => setConfirming(false),
  });

  const makeToken = () => (mcp.tokenSet ? setConfirming(true) : create.mutate());

  return (
    <>
      <Section label="Agent access">
        <RowGroup>
          <BodyRow className="flex flex-col gap-2">
            <Checkbox
              label="Allow agents to connect"
              description="When off, the MCP address refuses every client."
              checked={mcp.enabled}
              disabled={toggle.isPending}
              onChange={(event) =>
                toggle.mutate({ body: { mcp: { enabled: event.target.checked } } })
              }
            />
            {toggle.isError ? <InlineError>{errorMessage(toggle.error)}</InlineError> : null}
          </BodyRow>
          <BodyRow>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ui font-medium text-ink">Address</span>
              <CopyButton value={mcp.url} label="Copy address" />
            </div>
            <Value className="mt-0.5 block break-all">{mcp.url}</Value>
          </BodyRow>
          <Row title="Token" trailing={<Value>{mcp.tokenSet ? "Created" : "Not created"}</Value>} />
          <GroupFooter>
            {create.isError ? (
              <InlineError className="mr-auto">{errorMessage(create.error)}</InlineError>
            ) : null}
            <Button
              variant={mcp.tokenSet ? "secondary" : "primary"}
              loading={create.isPending}
              onClick={makeToken}
            >
              {mcp.tokenSet ? "Create a new token" : "Create a token"}
            </Button>
          </GroupFooter>
        </RowGroup>
        {token ? (
          <Callout intent="success" title="Copy this token now" className="mt-3">
            <p>It is shown once and cannot be looked up later.</p>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-meta">{token}</code>
              <CopyButton value={token} label="Copy token" />
            </p>
          </Callout>
        ) : null}
      </Section>

      <Section label="Client configuration">
        <p className="mb-2 text-meta text-ink-3">
          Paste this into any MCP client that connects over HTTP.
          {token
            ? " It already holds the token you just created."
            : ` Replace ${MCP_TOKEN_PLACEHOLDER} with a token from above.`}
        </p>
        <CodeBlock title="mcp.json" code={mcpClientConfig(mcp.url, token)} />
      </Section>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Create a new token?"
        description="The current token stops working at once, so every connected agent has to be updated."
        confirmLabel="Create a new token"
        destructive
        loading={create.isPending}
        onConfirm={() => create.mutate()}
      />
    </>
  );
}
