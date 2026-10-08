import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { errorMessage, useAuthState } from "../../api/index.js";
import { Button, Callout, Spinner } from "../ui/index.js";
import { Logo } from "./Logo.js";

function FullPage({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center px-gutter">{children}</div>;
}

export function LoadingScreen() {
  return (
    <FullPage>
      <div className="flex flex-col items-center gap-4 text-ink-2">
        <Logo />
        <Spinner size="lg" label="Loading Kick Rocks" />
      </div>
    </FullPage>
  );
}

function AuthError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <FullPage>
      <div className="flex w-full max-w-md flex-col gap-4">
        <Logo />
        <Callout
          intent="danger"
          title="Kick Rocks did not answer"
          action={
            <Button size="sm" onClick={retry}>
              <RefreshCw aria-hidden="true" className="size-3.5" />
              Try again
            </Button>
          }
        >
          {errorMessage(error)}
        </Callout>
      </div>
    </FullPage>
  );
}

/**
 * Sends the person where the instance's state says they belong: to /setup before a password
 * exists, to /login when signed out, and into the app otherwise. A 401 from any call ends the
 * session and lands here, so no page handles it.
 */
export function AuthGate() {
  const auth = useAuthState();
  const location = useLocation();

  if (auth.isPending) return <LoadingScreen />;
  if (auth.isError) return <AuthError error={auth.error} retry={() => auth.refetch()} />;
  if (auth.data.setupRequired) return <Navigate to="/setup" replace />;
  if (!auth.data.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** The mirror image, for /setup and /login: signed-in people go on into the app. */
export function PublicGate({ page }: { page: "setup" | "login" }) {
  const auth = useAuthState();
  const location = useLocation();

  if (auth.isPending) return <LoadingScreen />;
  if (auth.isError) return <AuthError error={auth.error} retry={() => auth.refetch()} />;
  if (auth.data.setupRequired && page === "login") return <Navigate to="/setup" replace />;
  if (!auth.data.setupRequired && page === "setup" && !auth.data.authenticated) {
    return <Navigate to="/login" replace />;
  }
  if (auth.data.authenticated) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from?.startsWith("/") ? from : "/"} replace />;
  }
  return <Outlet />;
}
