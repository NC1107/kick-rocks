import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CodeBlock,
  ConfirmDialog,
  CopyButton,
  DescriptionList,
  useToast,
} from "../../../components/ui/index.js";
import { claudeCodeCommand } from "../model.js";

export function McpCard({ mcp }: { mcp: SettingsView["mcp"] }) {
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const toggle = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (view) =>
      toast.success(view.mcp.enabled ? "Agent access turned on" : "Agent access turned off"),
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });
  const create = useApiMutation(API_ROUTES.settingsMcpToken, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (result) => {
      setConfirming(false);
      setToken(result.token);
      toast.success("Token created");
    },
    onError: (error) => {
      setConfirming(false);
      toast.error("That did not work", errorMessage(error));
    },
  });

  const makeToken = () => (mcp.tokenSet ? setConfirming(true) : create.mutate());

  return (
    <Card>
      <CardHeader
        title="Agent access"
        description="Let Claude Code or another MCP client pick up tasks, such as a blocked form, and report back."
      />
      <div className="flex flex-col gap-5">
        <Checkbox
          label="Allow agents to connect"
          description="When off, the MCP address refuses every client."
          checked={mcp.enabled}
          disabled={toggle.isPending}
          onChange={(event) => toggle.mutate({ body: { mcp: { enabled: event.target.checked } } })}
        />

        <DescriptionList
          items={[
            {
              term: "Address",
              description: (
                <span className="flex flex-wrap items-center gap-2">
                  <code className="break-all font-mono text-sm">{mcp.url}</code>
                  <CopyButton value={mcp.url} label="Copy address" />
                </span>
              ),
            },
            {
              term: "Token",
              description: mcp.tokenSet ? (
                <Badge tone="green">Created</Badge>
              ) : (
                <Badge>Not created</Badge>
              ),
            },
          ]}
        />

        {token ? (
          <Alert intent="success" title="Copy this token now">
            <p>It is shown once and cannot be looked up later.</p>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-sm">{token}</code>
              <CopyButton value={token} label="Copy token" />
            </p>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={mcp.tokenSet ? "secondary" : "primary"}
            loading={create.isPending}
            onClick={makeToken}
          >
            {mcp.tokenSet ? "Create a new token" : "Create a token"}
          </Button>
        </div>

        <div>
          <h3 className="mb-1 text-base font-semibold text-ink">Connect Claude Code</h3>
          <p className="mb-3 text-sm text-ink-muted">
            Run this in a terminal.
            {token
              ? " It already holds the token you just created."
              : " Replace <your-token> with a token from above."}{" "}
            Any other MCP client needs the address and the same bearer token.
          </p>
          <CodeBlock title="bash" code={claudeCodeCommand(mcp.url, token)} />
        </div>
      </div>

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
    </Card>
  );
}
