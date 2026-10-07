import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Alert, Button, Card, SkeletonText } from "../../../components/ui/index.js";
import { formatRelative } from "../../../lib/format.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { DigestCard } from "./DigestCard.js";
import { EventsCard } from "./EventsCard.js";
import { NtfyCard } from "./NtfyCard.js";
import { TelegramCard } from "./TelegramCard.js";

export function Component() {
  const settings = useApiQuery(API_ROUTES.notificationsGet);

  return (
    <>
      <SettingsHeader description="Hear about it when Kick Rocks needs you, by push and by a digest email." />
      {settings.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-5">
          <span className="sr-only">Loading notification settings</span>
          {[0, 1, 2].map((key) => (
            <Card key={key}>
              <SkeletonText lines={4} />
            </Card>
          ))}
        </div>
      ) : settings.isError ? (
        <Alert
          intent="danger"
          title="Could not load notification settings"
          action={
            <Button size="sm" onClick={() => settings.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(settings.error)}
        </Alert>
      ) : (
        <div className="flex flex-col gap-5">
          {settings.data.status.lastError ? (
            <Alert intent="danger" title="The last push did not go through">
              {settings.data.status.lastError}
            </Alert>
          ) : null}
          {settings.data.ntfy === null && settings.data.telegram === null ? (
            <Alert intent="info" title="No push channel yet">
              Add ntfy or Telegram below to get a push when a task is blocked, a listing needs your
              decision, or something breaks.
            </Alert>
          ) : settings.data.status.lastSentAt ? (
            <p className="text-sm text-ink-muted">
              Last push sent{" "}
              <time dateTime={settings.data.status.lastSentAt}>
                {formatRelative(settings.data.status.lastSentAt)}
              </time>
              .
            </p>
          ) : null}
          <NtfyCard ntfy={settings.data.ntfy} />
          <TelegramCard telegram={settings.data.telegram} />
          <EventsCard categories={settings.data.categories} maxPerHour={settings.data.maxPerHour} />
          <DigestCard
            digest={settings.data.digest}
            mailboxReady={settings.data.mailboxReady}
            status={settings.data.status}
          />
        </div>
      )}
    </>
  );
}
