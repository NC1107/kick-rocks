import { isRouteErrorResponse, useRouteError } from "react-router";
import { LinkButton } from "../ui/index.js";
import { Logo } from "./Logo.js";

/** Shown when a page throws while rendering or its code fails to load. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="grid min-h-dvh place-items-center px-gutter">
      <div className="flex max-w-md flex-col items-start gap-4">
        <Logo />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {notFound ? "That page does not exist" : "This page hit a problem"}
        </h1>
        <p className="text-base text-ink-muted">
          {notFound
            ? "The address may be mistyped, or the page may have moved."
            : "Reload the page to try again. If it keeps happening, the details are in the browser console."}
        </p>
        {import.meta.env.DEV && error instanceof Error ? (
          <pre className="max-w-full overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-sm text-ink">
            {error.message}
          </pre>
        ) : null}
        <LinkButton to="/" variant="primary" reloadDocument>
          Go to the dashboard
        </LinkButton>
      </div>
    </div>
  );
}
