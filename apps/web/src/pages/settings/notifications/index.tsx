import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import {
  Button,
  Callout,
  RelativeTime,
  RowGroup,
  Section,
  SkeletonText,
} from "../../../components/ui/index.js";
import { BodyRow, SETTINGS_WIDTH } from "../rows.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { DigestCard } from "./DigestCard.js";
import { EventsCard } from "./EventsCard.js";
import { NtfyCard } from "./NtfyCard.js";
import { TelegramCard } from "./TelegramCard.js";

export function Component() {
  const settings = useApiQuery(API_ROUTES.notificationsGet);

  return (
    <>
      <SettingsHeader
        section="Notifications"
        description="Push and digest email when something needs you"
      />
      <div className={SETTINGS_WIDTH}>
        {settings.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">Loading notification settings</span>
            <Section label="ntfy">
              <RowGroup>
                <BodyRow>
                  <SkeletonText lines={4} />
                </BodyRow>
              </RowGroup>
            </Section>
          </div>
        ) : settings.isError ? (
          <Callout
            intent="danger"
            title="Could not load notification settings"
            action={
              <Button size="sm" onClick={() => settings.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(settings.error)}
          </Callout>
        ) : (
          <div className="flex flex-col gap-4">
            {settings.data.status.lastError ? (
              <Callout intent="danger" title="The last push did not go through">
                {settings.data.status.lastError}
              </Callout>
            ) : null}
            {settings.data.ntfy === null && settings.data.telegram === null ? (
              <Callout intent="info" title="No push channel yet">
                Add ntfy or Telegram below to get a push when a task is blocked, a record needs your
                decision, or something breaks.
              </Callout>
            ) : settings.data.status.lastSentAt ? (
              <p className="text-meta text-ink-3">
                Last push sent <RelativeTime iso={settings.data.status.lastSentAt} />.
              </p>
            ) : null}
            <NtfyCard ntfy={settings.data.ntfy} />
            <TelegramCard telegram={settings.data.telegram} />
            <EventsCard
              categories={settings.data.categories}
              maxPerHour={settings.data.maxPerHour}
            />
            <DigestCard
              digest={settings.data.digest}
              mailboxReady={settings.data.mailboxReady}
              status={settings.data.status}
            />
          </div>
        )}
      </div>
    </>
  );
}
