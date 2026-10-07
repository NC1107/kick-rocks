import { API_ROUTES, type Dashboard } from "@kickrocks/shared";
import { Inbox, Send } from "lucide-react";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
} from "../../components/ui/index.js";
import {
  ActivityList,
  AttentionCard,
  MailboxNotices,
  SendingCard,
  StatusCard,
} from "./sections.js";

const REFRESH_MS = 30_000;

export function Component() {
  return (
    <RequireProfile>
      {(profile) => <DashboardView profileId={profile.id} name={profile.displayName} />}
    </RequireProfile>
  );
}

function DashboardView({ profileId, name }: { profileId: string; name: string }) {
  const query = useApiQuery(API_ROUTES.dashboardGet, {
    params: { id: profileId },
    refetchInterval: REFRESH_MS,
  });

  // A fresh profile's empty state already carries the way forward, so the header adds no second one.
  const fresh = query.data?.total === 0;
  const header = (
    <PageHeader
      title="Dashboard"
      description={`Where requests for ${name} stand, and what needs you.`}
      actions={
        fresh ? undefined : (
          <LinkButton to="/campaigns/new" variant="primary">
            <Send aria-hidden="true" className="size-4" />
            New campaign
          </LinkButton>
        )
      }
    />
  );

  if (query.isPending) {
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  }

  if (query.error) {
    return (
      <>
        {header}
        <Alert
          intent="danger"
          title="Could not load the dashboard"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}
      <DashboardBody dashboard={query.data} profileId={profileId} />
    </>
  );
}

function DashboardBody({ dashboard, profileId }: { dashboard: Dashboard; profileId: string }) {
  const fresh = dashboard.total === 0;
  return (
    <div className="flex flex-col gap-6">
      <MailboxNotices dashboard={dashboard} profileId={profileId} showMissing={!fresh} />
      {fresh ? (
        <EmptyState
          icon={Inbox}
          title="No requests yet"
          description={
            dashboard.mailbox
              ? "Start a campaign to send opt-out and deletion requests to data brokers and companies."
              : "Connect a mailbox first, then start a campaign to send opt-out and deletion requests."
          }
          actions={
            <>
              {dashboard.mailbox ? null : (
                <LinkButton to={`/profiles/${profileId}/mailbox`} variant="primary">
                  Connect a mailbox
                </LinkButton>
              )}
              <LinkButton to="/campaigns/new" variant={dashboard.mailbox ? "primary" : "secondary"}>
                Start a campaign
              </LinkButton>
            </>
          }
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1">
            <AttentionCard attention={dashboard.attention} />
            <SendingCard dashboard={dashboard} />
          </div>
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
            <StatusCard dashboard={dashboard} />
            <Card>
              <CardHeader title="Recent activity" />
              <ActivityList events={dashboard.recentEvents} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}
