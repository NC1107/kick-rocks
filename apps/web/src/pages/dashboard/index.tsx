import { API_ROUTES, type Dashboard } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  Button,
  Callout,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
} from "../../components/ui/index.js";
import {
  CheckForRepliesButton,
  ReplyCheckResult,
  useReplyCheck,
} from "../mailbox/check-for-replies.js";
import {
  ActivitySection,
  AttentionSection,
  MailboxNotices,
  RequestsSection,
  SendingSection,
} from "./sections.js";

const REFRESH_MS = 30_000;

export function Component() {
  return (
    <RequireProfile>
      {(profile) => (
        <DashboardView profileId={profile.id} mailboxConnected={profile.mailboxConnected} />
      )}
    </RequireProfile>
  );
}

function DashboardView({
  profileId,
  mailboxConnected,
}: {
  profileId: string;
  mailboxConnected: boolean;
}) {
  const check = useReplyCheck(profileId);
  const query = useApiQuery(API_ROUTES.dashboardGet, {
    params: { id: profileId },
    refetchInterval: REFRESH_MS,
  });

  // A fresh profile's empty state already carries the way forward, so the header adds no second one.
  const fresh = query.data?.total === 0;
  const header = (
    <PageHeader
      title="Dashboard"
      description="Where requests stand"
      actions={
        <>
          {mailboxConnected && !fresh ? <CheckForRepliesButton check={check} /> : null}
          {fresh ? null : (
            <LinkButton to="/campaigns/new" variant="primary">
              New campaign
            </LinkButton>
          )}
        </>
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
        <Callout
          intent="danger"
          title="Could not load the dashboard"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      </>
    );
  }

  return (
    <>
      {header}
      <ReplyCheckResult check={check} className="mb-5" />
      <DashboardBody dashboard={query.data} profileId={profileId} />
    </>
  );
}

function DashboardBody({ dashboard, profileId }: { dashboard: Dashboard; profileId: string }) {
  const fresh = dashboard.total === 0;
  return (
    <div className="flex flex-col gap-5">
      <MailboxNotices dashboard={dashboard} profileId={profileId} showMissing={!fresh} />
      {fresh ? (
        <EmptyState
          title="No requests yet."
          description={
            dashboard.mailbox
              ? "Start a campaign to send opt-out and deletion requests."
              : "Connect a mailbox, then start a campaign."
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
        <>
          <AttentionSection attention={dashboard.attention} />
          <RequestsSection dashboard={dashboard} />
          <SendingSection dashboard={dashboard} />
          <ActivitySection events={dashboard.recentEvents} />
        </>
      )}
    </div>
  );
}

function SkeletonLabel({ width }: { width: string }) {
  return (
    <div className="mt-2.5 mb-1.5 flex min-h-5 items-center">
      <Skeleton className={`h-2.5 ${width}`} />
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line">
      {Array.from({ length: rows }, (_, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
        <div key={row} className="flex h-row items-center justify-between gap-6 px-3.5">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3.5 w-6" />
        </div>
      ))}
    </div>
  );
}

const SKELETON_GROUP_ROWS = [3, 4, 3];

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">Loading</span>
      <div>
        <SkeletonLabel width="w-20" />
        <SkeletonRows rows={4} />
      </div>
      <div>
        <SkeletonLabel width="w-24" />
        <Skeleton className="h-1.5 w-full rounded-full" />
        <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-3">
          {SKELETON_GROUP_ROWS.map((rows, group) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder groups have no identity
            <div key={group}>
              <div className="flex items-baseline justify-between gap-3">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-4 w-6" />
              </div>
              <div className="mt-2 flex flex-col divide-y divide-line border-t border-line">
                {Array.from({ length: rows }, (_, row) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
                  <div key={row} className="flex h-8 items-center justify-between gap-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-4" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
