import { useEffect, useState } from "react";

interface Health {
  ok: boolean;
  version: string;
  profiles: number;
  brokers: { available: boolean; total: number; generatedAt?: string };
}

type HealthState =
  | { status: "loading" }
  | { status: "ready"; health: Health }
  | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`server answered ${response.status}`);
        setState({ status: "ready", health: (await response.json()) as Health });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Kick Rocks</h1>
        <p className="text-base" style={{ color: "var(--kr-muted)" }}>
          Tells data brokers and companies to stop selling your data, from your own mailbox.
        </p>
      </header>
      <section
        className="rounded-lg border p-5"
        style={{ background: "var(--kr-card)", borderColor: "var(--kr-border)" }}
      >
        <h2
          className="mb-3 text-sm font-medium uppercase tracking-wide"
          style={{ color: "var(--kr-muted)" }}
        >
          Server
        </h2>
        {state.status === "loading" && <p>Checking the server.</p>}
        {state.status === "error" && (
          <p style={{ color: "var(--kr-accent)" }}>Could not reach the server: {state.message}</p>
        )}
        {state.status === "ready" && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt style={{ color: "var(--kr-muted)" }}>Version</dt>
            <dd>{state.health.version}</dd>
            <dt style={{ color: "var(--kr-muted)" }}>Profiles</dt>
            <dd>{state.health.profiles}</dd>
            <dt style={{ color: "var(--kr-muted)" }}>Brokers in dataset</dt>
            <dd>
              {state.health.brokers.available ? state.health.brokers.total : "dataset not built"}
            </dd>
          </dl>
        )}
      </section>
    </main>
  );
}
