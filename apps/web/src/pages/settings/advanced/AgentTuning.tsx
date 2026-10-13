import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Button, Callout } from "../../../components/ui/index.js";
import { AdvancedGate } from "../agents/Advanced.js";
import { AgentSetup, SetupError, SetupSkeleton, useAdvancedOpen } from "../agents/AgentSetup.js";

/** Model choice, the safety gate and the worker's settings: what an agent setup needs beyond the helpers. */
export function AgentTuning() {
  const settings = useApiQuery(API_ROUTES.settingsGet);
  const [open, setOpen] = useAdvancedOpen();
  const setup = useApiQuery(API_ROUTES.settingsAgentSetup, { query: {} });

  if (settings.isError) {
    return (
      <Callout
        intent="danger"
        title="Could not load agent settings"
        action={
          <Button size="sm" onClick={() => settings.refetch()}>
            Try again
          </Button>
        }
      >
        {errorMessage(settings.error)}
      </Callout>
    );
  }
  if (settings.isPending) return <SetupSkeleton />;
  if (setup.isSuccess) {
    return (
      <AgentSetup
        view={setup.data}
        settings={settings.data}
        onRecheck={() => setup.refetch()}
        rechecking={setup.isFetching}
      />
    );
  }
  return (
    <>
      {setup.isError ? (
        <SetupError error={setup.error} onRetry={() => setup.refetch()} />
      ) : (
        <SetupSkeleton />
      )}
      <AdvancedGate settings={settings.data} open={open} onOpenChange={setOpen} />
    </>
  );
}
