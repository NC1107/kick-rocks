import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import {
  createQueryClient,
  prefetchAuthState,
  prefetchProfiles,
  useUnauthorizedListener,
} from "./api/index.js";
import { router } from "./router.js";

const queryClient = createQueryClient();
void prefetchAuthState(queryClient);
prefetchProfiles(queryClient);

/** Any 401 from a signed-in route ends the session; the auth gate then shows /login. */
function SessionWatcher() {
  useUnauthorizedListener();
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionWatcher />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
