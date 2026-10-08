import { isRouteErrorResponse, useRouteError } from "react-router";
import { LinkButton } from "../ui/index.js";
import { Logo } from "./Logo.js";

/** Shown when a page throws while rendering or its code fails to load. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="grid min-h-dvh place-items-center px-gutter">
      <div className="flex w-full max-w-[22.5rem] flex-col items-start gap-3">
        <Logo />
        <div>
          <h1 className="text-heading font-semibold text-ink">
            {notFound ? "That page does not exist." : "This page hit a problem."}
          </h1>
          <p className="mt-1 text-ui text-ink-2">
            {notFound
              ? "The address may be mistyped, or the page may have moved."
              : "Reload to try again. If it keeps happening, the details are in the browser console."}
          </p>
        </div>
        {import.meta.env.DEV && error instanceof Error ? (
          <pre className="max-w-full overflow-x-auto rounded-md border border-line bg-hover p-3 font-mono text-meta text-ink">
            {error.message}
          </pre>
        ) : null}
        <LinkButton to="/" reloadDocument>
          Go to the dashboard
        </LinkButton>
      </div>
    </div>
  );
}
