import { Navigate } from "react-router";

/** Recipes live on the Advanced page now; this keeps old links working. */
export function Component() {
  return <Navigate to="/settings/advanced#recipes" replace />;
}
