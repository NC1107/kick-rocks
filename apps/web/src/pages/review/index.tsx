import { API_ROUTES, type ReviewQueue } from "@kickrocks/shared";
import { CircleCheck, Mail, PauseCircle, ShieldQuestion, UserSearch } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonText,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "../../components/ui/index.js";
import { BlockedTaskCard } from "./BlockedTaskCard.js";
import { MatchCard } from "./MatchCard.js";
import { MessageCard } from "./MessageCard.js";
import { firstBusyTab, parseTab, REVIEW_TABS, type ReviewTab, tabCounts } from "./model.js";
import { ScansPanel } from "./ScansPanel.js";
import { VerificationCard } from "./VerificationCard.js";

const TAB_LABELS: Record<ReviewTab, string> = {
  blocked: "Blocked",
  matches: "Records to confirm",
  verifications: "More details asked",
  mail: "Unclassified mail",
  failed: "Failed",
  scans: "Scans",
};

export function Component() {
  return <RequireProfile>{(profile) => <Review profileId={profile.id} />}</RequireProfile>;
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading the review queue</span>
      <Skeleton className="h-10 w-full max-w-xl" />
      <Card>
        <SkeletonText lines={5} />
      </Card>
      <Card>
        <SkeletonText lines={5} />
      </Card>
    </div>
  );
}

function Cards({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

function Review({ profileId }: { profileId: string }) {
  const [params, setParams] = useSearchParams();
  const queue = useApiQuery(API_ROUTES.reviewQueue, { query: { profileId } });

  const selectTab = (tab: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Review"
        description="Everything that needs a person: stuck tasks, records to confirm, and mail nobody could classify."
      />
      {queue.isPending ? (
        <Loading />
      ) : queue.isError ? (
        <Alert
          intent="danger"
          title="Could not load the review queue"
          action={
            <Button size="sm" onClick={() => queue.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(queue.error)}
        </Alert>
      ) : (
        <Queue
          queue={queue.data}
          profileId={profileId}
          tab={parseTab(params.get("tab")) ?? firstBusyTab(queue.data)}
          onTab={selectTab}
        />
      )}
    </>
  );
}

function Queue({
  queue,
  profileId,
  tab,
  onTab,
}: {
  queue: ReviewQueue;
  profileId: string;
  tab: ReviewTab;
  onTab: (tab: string) => void;
}) {
  const counts = tabCounts(queue);
  return (
    <Tabs value={tab} onValueChange={onTab}>
      <TabList aria-label="Review queue">
        {REVIEW_TABS.map((value) => {
          const count = value === "scans" ? 0 : counts[value];
          return (
            <Tab key={value} value={value}>
              {TAB_LABELS[value]}
              {count > 0 ? (
                <Badge tone={value === "failed" ? "red" : "amber"}>
                  {count}
                  <span className="sr-only"> waiting</span>
                </Badge>
              ) : null}
            </Tab>
          );
        })}
      </TabList>

      <TabPanel value="blocked">
        {queue.blockedTasks.length === 0 ? (
          <EmptyState
            icon={PauseCircle}
            title="Nothing is blocked"
            description="When a site shows a CAPTCHA or asks for a phone code or an ID, the task waits here for you."
          />
        ) : (
          <Cards>
            {queue.blockedTasks.map((item) => (
              <BlockedTaskCard key={item.task.id} item={item} variant="blocked" />
            ))}
          </Cards>
        )}
      </TabPanel>

      <TabPanel value="matches">
        {queue.matches.length === 0 ? (
          <EmptyState
            icon={UserSearch}
            title="No records to confirm"
            description="Records a scan finds appear here. Nothing is removed until you say a record is yours."
          />
        ) : (
          <Cards>
            {queue.matches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </Cards>
        )}
      </TabPanel>

      <TabPanel value="verifications">
        {queue.verifications.length === 0 ? (
          <EmptyState
            icon={ShieldQuestion}
            title="Nobody is asking for more details"
            description="If a broker asks for more identifiers before it acts, you choose here what to share."
          />
        ) : (
          <Cards>
            {queue.verifications.map((item) => (
              <VerificationCard key={item.request.id} item={item} />
            ))}
          </Cards>
        )}
      </TabPanel>

      <TabPanel value="mail">
        {queue.messages.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No unclassified mail"
            description="Replies Kick Rocks cannot place on its own show up here."
          />
        ) : (
          <Cards>
            {queue.messages.map((message) => (
              <MessageCard key={message.id} message={message} profileId={profileId} />
            ))}
          </Cards>
        )}
      </TabPanel>

      <TabPanel value="failed">
        {queue.failedTasks.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="No failed tasks"
            description="A task that gave up for good in the last 30 days is listed here so you can retry it."
          />
        ) : (
          <Cards>
            <Alert intent="warning" title="These tasks gave up">
              Nothing retries them on its own. Retry one, or open the page and finish it by hand.
            </Alert>
            {queue.failedTasks.map((item) => (
              <BlockedTaskCard key={item.task.id} item={item} variant="failed" />
            ))}
          </Cards>
        )}
      </TabPanel>

      <TabPanel value="scans">
        <ScansPanel profileId={profileId} />
      </TabPanel>
    </Tabs>
  );
}
