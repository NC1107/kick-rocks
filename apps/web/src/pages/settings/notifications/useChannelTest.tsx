import { API_ROUTES, type NotificationChannel } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import { Button, Callout, useToast } from "../../../components/ui/index.js";

const NAMES: Record<NotificationChannel, string> = { ntfy: "ntfy", telegram: "Telegram" };

/**
 * Sends a test message through a saved channel. `button` goes in the card footer and `result`
 * under the form, so the answer stays on screen after the toast is gone.
 */
export function useChannelTest(channel: NotificationChannel, disabled: boolean) {
  const toast = useToast();
  const [failure, setFailure] = useState<string | null>(null);

  const test = useApiMutation(API_ROUTES.notificationsTest, {
    invalidates: [API_ROUTES.notificationsGet],
    onSuccess: (result) => {
      setFailure(result.error);
      if (result.ok) toast.success(`Test sent to ${NAMES[channel]}`);
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  return {
    button: (
      <Button
        loading={test.isPending}
        disabled={disabled}
        onClick={() => {
          setFailure(null);
          test.mutate({ body: { channel } });
        }}
      >
        Send test
      </Button>
    ),
    result: failure ? (
      <Callout intent="danger" title={`${NAMES[channel]} did not take the test`}>
        {failure}
      </Callout>
    ) : null,
  };
}
