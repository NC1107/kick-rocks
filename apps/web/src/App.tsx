import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { createQueryClient, useUnauthorizedListener } from "./api/index.js";
import { ToastProvider } from "./components/ui/index.js";
import { router } from "./router.js";

const queryClient = createQueryClient();

/** Any 401 from a signed-in route ends the session; the auth gate then shows /login. */
function SessionWatcher() {
  useUnauthorizedListener();
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionWatcher />
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
