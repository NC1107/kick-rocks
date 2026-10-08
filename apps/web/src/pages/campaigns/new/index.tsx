import {
  API_ROUTES,
  type CampaignBody,
  type CampaignPreset,
  type CampaignPreview,
  type ProfileSummary,
  type RequestRight,
  type TargetFilter,
} from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import { RequireProfile } from "../../../components/layout/RequireProfile.js";
import {
  Button,
  Callout,
  Checkbox,
  ConfirmDialog,
  PageHeader,
  RadioGroup,
  type RadioOption,
  Row,
  RowGroup,
  Section,
  useToast,
} from "../../../components/ui/index.js";
import { formatCount, pluralize } from "../../../lib/format.js";
import {
  CONTACT_METHOD_LABELS,
  DIFFICULTY_LABELS,
  PRIORITY_LABELS,
  REQUIREMENT_LABELS,
  RIGHT_LABELS,
  TARGET_CATEGORY_LABELS,
  TARGET_KIND_LABELS,
} from "../../../lib/labels.js";
import {
  channelOf,
  countByChannel,
  countNovelty,
  outcomeChannel,
  parseFilterParam,
  parseTargetIds,
  waitingForPerson,
} from "../channels.js";
import {
  AdvisoryList,
  CHANNEL_LABELS,
  ChannelReadout,
  EmailPreview,
  FirstTargets,
  SkippedList,
  WaitingForPersonNotice,
} from "./PreviewPanel.js";
import { TargetPicker } from "./TargetPicker.js";
import { useAllTargets } from "./use-all-targets.js";

const PRESET_OPTIONS: readonly RadioOption<CampaignPreset>[] = [
  {
    value: "easy",
    label: "Easy ones",
    description: "Email requests Kick Rocks sends on its own. Nothing asked of you.",
  },
  {
    value: "email_brokers",
    label: "Data brokers with an email address",
    description: "Brokers that take requests by email.",
  },
  {
    value: "companies",
    label: "Everyday companies",
    description: "Retailers, banks, carriers, and similar.",
  },
  {
    value: "people_search",
    label: "People-search sites",
    description: "Scanned first. You confirm each record.",
  },
  {
    value: "everything",
    label: "Everything",
    description: "Every target.",
  },
];

const RIGHT_HELP: Record<RequestRight, string> = {
  opt_out: "Stop selling or sharing my data.",
  delete: "Erase what they hold. Companies may close accounts.",
};

const RIGHT_TOKENS: Record<RequestRight, string> = {
  opt_out: "opt-out",
  delete: "delete",
};

const RIGHT_ORDER: readonly RequestRight[] = ["opt_out", "delete"];

type Choice =
  | { kind: "preset"; preset: CampaignPreset }
  | { kind: "targets" }
  | { kind: "filter"; filter: TargetFilter }
  | null;

/** The filter in words, such as "Type: Data broker, Difficulty: Easy", for the row that stands for it. */
function describeFilter(filter: TargetFilter): string {
  const parts = [
    filter.q ? `Search: ${filter.q}` : null,
    filter.kind ? `Type: ${TARGET_KIND_LABELS[filter.kind]}` : null,
    filter.category ? `Category: ${TARGET_CATEGORY_LABELS[filter.category]}` : null,
    filter.contactMethod ? `Contact: ${CONTACT_METHOD_LABELS[filter.contactMethod]}` : null,
    filter.requirement ? `Needs: ${REQUIREMENT_LABELS[filter.requirement]}` : null,
    filter.priority ? `Priority: ${PRIORITY_LABELS[filter.priority]}` : null,
    filter.difficulty ? `Difficulty: ${DIFFICULTY_LABELS[filter.difficulty]}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Every target";
}

function noveltyMeta(items: CampaignPreview["items"]): ReactNode {
  const { fresh, handled } = countNovelty(items);
  if (handled === 0) return `${formatCount(fresh)} new`;
  return (
    <>
      <span className="whitespace-nowrap">{formatCount(fresh)} new,</span>{" "}
      <span className="whitespace-nowrap">{formatCount(handled)} already handled</span>
    </>
  );
}

export function Component() {
  return <RequireProfile>{(profile) => <Builder profile={profile} />}</RequireProfile>;
}

function Builder({ profile }: { profile: ProfileSummary }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const targetIds = useMemo(() => parseTargetIds(params.get("targets")), [params]);
  const [preset, setPreset] = useState<CampaignPreset | null>(null);
  const [rights, setRights] = useState<readonly RequestRight[]>(["opt_out"]);
  const [confirming, setConfirming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(() => targetIds.length > 0);
  const pickerSummary = useRef<HTMLElement>(null);

  const filter = useMemo(() => parseFilterParam(params.get("filter")), [params]);
  const choice: Choice = filter
    ? { kind: "filter", filter }
    : targetIds.length > 0
      ? { kind: "targets" }
      : preset
        ? { kind: "preset", preset }
        : null;
  const allTargets = useAllTargets();
  const facets = useApiQuery(API_ROUTES.targetsFacets, { staleTime: 60_000 });
  const settings = useApiQuery(API_ROUTES.settingsGet);
  const easyCount = facets.data?.difficulty.find((entry) => entry.value === "easy")?.count;

  const body: CampaignBody | null =
    choice && rights.length > 0
      ? {
          selection:
            choice.kind === "filter"
              ? { filter: choice.filter }
              : choice.kind === "targets"
                ? { targetIds }
                : { preset: choice.preset },
          rights: [...rights],
        }
      : null;
  const bodyKey = body ? JSON.stringify(body) : null;

  const preview = useApiMutation(API_ROUTES.campaignsPreview);
  const { mutate: runPreview, reset: resetPreview } = preview;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialized body is the trigger
  useEffect(() => {
    if (!bodyKey) {
      resetPreview();
      return;
    }
    runPreview({ params: { id: profile.id }, body: JSON.parse(bodyKey) as CampaignBody });
  }, [bodyKey, profile.id]);

  const create = useApiMutation(API_ROUTES.campaignsCreate, {
    invalidates: [
      API_ROUTES.requestsList,
      API_ROUTES.dashboardGet,
      API_ROUTES.reviewQueue,
      API_ROUTES.scansList,
    ],
    onSuccess: (result) => {
      setConfirming(false);
      const sent = result.counts.request_created;
      const scans = result.counts.scan_started;
      const parts = [
        sent > 0 ? `${pluralize(sent, "request")} queued to send` : null,
        scans > 0 ? `${pluralize(scans, "scan")} started` : null,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? parts.join(", ") : "Nothing new to send");
      navigate(scans > 0 && sent === 0 ? "/review" : "/requests");
    },
    onError: () => setConfirming(false),
  });

  const targetsById = useMemo(
    () => new Map((allTargets.data ?? []).map((target) => [target.id, target])),
    [allTargets.data],
  );
  const result = preview.data;
  const counts = useMemo(
    () => (result ? countByChannel(result.items, targetsById) : null),
    [result, targetsById],
  );
  const work = result ? result.counts.request_created + result.counts.scan_started : 0;
  const firstRequest = result?.items.find((item) => {
    if (item.outcome !== "request_created") return false;
    const target = targetsById.get(item.targetId);
    return target ? channelOf(target) === "email" : false;
  });
  const canSend = body !== null && work > 0 && !preview.isPending;
  const noMailbox = !profile.mailboxConnected;
  // Settings still loading counts as an agent seen, so the notice never flashes and goes away.
  const agentSeen = settings.data ? settings.data.worker.model !== null : true;
  const waiting = counts ? waitingForPerson(counts, agentSeen) : 0;
  const recipient = useApiQuery(
    API_ROUTES.targetsGet,
    firstRequest ? { params: { id: firstRequest.targetId } } : skipToken,
  );

  const toggleRight = (right: RequestRight, on: boolean) =>
    setRights((current) =>
      RIGHT_ORDER.filter((candidate) => (candidate === right ? on : current.includes(candidate))),
    );

  const setTargetIds = (ids: readonly string[]) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("filter");
        if (ids.length > 0) next.set("targets", ids.map(encodeURIComponent).join(","));
        else next.delete("targets");
        return next;
      },
      { replace: true },
    );

  const chooseGroup = (next: CampaignPreset) => {
    setTargetIds([]);
    setPreset(next);
  };

  const toggleTarget = (id: string, on: boolean) => {
    if (on) setPreset(null);
    setTargetIds(
      on
        ? [...targetIds.filter((existing) => existing !== id), id]
        : targetIds.filter((existing) => existing !== id),
    );
  };

  const clearTargets = () => {
    setTargetIds([]);
    // The button leaves with its row, so focus moves to the control that stays.
    pickerSummary.current?.focus();
  };

  const selectedNames = targetIds
    .slice(0, 4)
    .map((id) => targetsById.get(id)?.name ?? id)
    .join(", ");

  const firstTargets = useMemo(
    () =>
      (result?.items ?? [])
        .filter((item) => item.outcome !== "skipped")
        .map((item) => ({
          id: item.targetId,
          name: item.targetName,
          channel: outcomeChannel(item, targetsById),
        })),
    [result, targetsById],
  );

  const presetOptions = useMemo(
    () =>
      PRESET_OPTIONS.map((option) =>
        option.value === preset && result && choice?.kind === "preset"
          ? { ...option, meta: noveltyMeta(result.items) }
          : option.value === "easy" && easyCount !== undefined
            ? { ...option, meta: pluralize(easyCount, "target") }
            : option,
      ),
    [preset, result, choice?.kind, easyCount],
  );

  const summary = canSend
    ? [
        result && result.counts.request_created > 0
          ? pluralize(result.counts.request_created, "request")
          : null,
        result && result.counts.scan_started > 0
          ? pluralize(result.counts.scan_started, "scan")
          : null,
        rights.map((right) => RIGHT_TOKENS[right]).join(", "),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <>
      <PageHeader
        title="New campaign"
        description={`Asking for ${profile.displayName}`}
        back={{ to: "/requests", label: "Requests" }}
      />

      {noMailbox ? (
        <Callout
          intent="warning"
          title="No mailbox connected"
          className="mb-4"
          action={
            <Link
              to={`/profiles/${encodeURIComponent(profile.id)}/mailbox`}
              className="text-accent-text underline underline-offset-2"
            >
              Connect a mailbox
            </Link>
          }
        >
          Email requests are skipped until this profile has a mailbox to send from.
        </Callout>
      ) : null}

      <div className="grid gap-x-8 gap-y-5 pb-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex max-w-120 flex-col gap-4">
          <Section label="Who">
            {choice?.kind === "filter" ? (
              <RowGroup>
                <Row
                  title={
                    result
                      ? `${pluralize(result.items.length, "target")} match your filters`
                      : "Targets matching your filters"
                  }
                  description={describeFilter(choice.filter)}
                  trailingBelowOnPhone
                  trailing={
                    <Button size="sm" onClick={() => setTargetIds([])}>
                      Choose a group instead
                    </Button>
                  }
                />
              </RowGroup>
            ) : (
              <RadioGroup
                legend="Group of targets"
                hideLegend
                rows
                value={choice?.kind === "targets" ? null : preset}
                onValueChange={chooseGroup}
                options={presetOptions}
              />
            )}
          </Section>

          {choice?.kind === "filter" ? null : (
            <Section
              label="Or pick targets"
              {...(targetIds.length > 0 ? { count: targetIds.length } : {})}
            >
              <details
                open={pickerOpen}
                onToggle={(event) => setPickerOpen(event.currentTarget.open)}
                className="group rounded-md border border-line bg-surface"
              >
                <summary
                  ref={pickerSummary}
                  className="flex min-h-9 max-sm:min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3.5 text-ui text-ink transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden"
                >
                  <span>Search and pick targets</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 text-ink-3 transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-t border-line p-3">
                  <TargetPicker selectedIds={targetIds} onToggle={toggleTarget} />
                </div>
              </details>
              {targetIds.length > 0 ? (
                <RowGroup className="mt-2.5">
                  <Row
                    title={`${pluralize(targetIds.length, "target")} selected`}
                    description={`${selectedNames}${targetIds.length > 4 ? `, and ${targetIds.length - 4} more` : ""}`}
                    trailingBelowOnPhone
                    trailing={
                      <Button size="sm" onClick={clearTargets}>
                        Clear targets
                      </Button>
                    }
                  />
                </RowGroup>
              ) : null}
            </Section>
          )}

          <Section label="Ask for">
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="sr-only">What to ask for</legend>
              <RowGroup>
                {RIGHT_ORDER.map((right) => (
                  <Checkbox
                    key={right}
                    label={RIGHT_LABELS[right]}
                    description={RIGHT_HELP[right]}
                    checked={rights.includes(right)}
                    onChange={(event) => toggleRight(right, event.target.checked)}
                    className="items-center px-3.5 py-2 transition-colors duration-100 hover:bg-hover"
                  />
                ))}
              </RowGroup>
            </fieldset>
            {choice?.kind !== "targets" ? (
              <p className="mt-2 text-meta text-ink-3">
                Group and filter campaigns only ask companies to stop selling. To ask for deletion,
                pick targets.
              </p>
            ) : null}
            {rights.length === 0 ? (
              <p role="alert" className="mt-2 text-caption text-danger-text">
                Choose at least one.
              </p>
            ) : null}
          </Section>
        </div>

        <section aria-label="Preview" className="flex min-w-0 flex-col gap-4">
          <Section label="Would send">
            {preview.isError ? (
              <Callout
                intent="danger"
                title="Could not build the preview"
                action={
                  <Button
                    size="sm"
                    onClick={() =>
                      runPreview({ params: { id: profile.id }, body: JSON.parse(bodyKey ?? "{}") })
                    }
                  >
                    Try again
                  </Button>
                }
              >
                {errorMessage(preview.error)}
              </Callout>
            ) : (
              <ChannelReadout counts={counts} loading={body !== null && !result} />
            )}
          </Section>
          {result && counts ? (
            <>
              {work === 0 ? (
                <Callout intent="info" title="Nothing to send">
                  {choice?.kind !== "preset"
                    ? "Every target you selected is skipped. Read the reasons below or choose a group instead."
                    : "Every target in this group is skipped. Pick another group or read the reasons below."}
                </Callout>
              ) : null}
              <WaitingForPersonNotice count={waiting} />
              <FirstTargets targets={firstTargets} />
              {result.sampleEmail ? (
                <EmailPreview
                  email={result.sampleEmail}
                  fromAddress={profile.primaryEmail}
                  targetName={firstRequest?.targetName ?? null}
                  toAddress={recipient.data?.privacyEmail ?? null}
                />
              ) : null}
              <AdvisoryList items={result.items} />
              <SkippedList items={result.items} />
            </>
          ) : null}
        </section>
      </div>

      <div
        data-testid="send-bar"
        className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-canvas py-3"
      >
        <p className="min-w-0 text-meta" aria-live="polite">
          {summary ? (
            <span className="font-mono text-ink-2">{summary}</span>
          ) : create.isError ? (
            <span className="text-danger-text">
              Could not send the requests. {errorMessage(create.error)}
            </span>
          ) : (
            <span className="text-ink-3">
              {body === null
                ? choice
                  ? "Choose at least one right to see a preview."
                  : "Pick a group and at least one right to see a preview."
                : "Nothing to send yet."}
            </span>
          )}
        </p>
        <Button variant="primary" disabled={!canSend} onClick={() => setConfirming(true)}>
          Send requests
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send these requests?"
        description="Emails go out one at a time within your daily limit. You can stop any that have not gone out."
        confirmLabel="Send requests"
        loading={create.isPending}
        onConfirm={() => body && create.mutate({ params: { id: profile.id }, body })}
      >
        {counts ? (
          <dl className="m-0 flex flex-col gap-1 text-ui">
            {(["email", "form", "manual", "scan"] as const)
              .filter((channel) => counts[channel] > 0)
              .map((channel) => (
                <div key={channel} className="flex justify-between gap-6">
                  <dt className="text-ink-2 first-letter:uppercase">{CHANNEL_LABELS[channel]}</dt>
                  <dd className="m-0 font-mono text-ink tabular-nums">
                    {formatCount(counts[channel])}
                  </dd>
                </div>
              ))}
            <div className="mt-1 flex justify-between gap-6 border-t border-line pt-2">
              <dt className="text-ink-2">Asking for</dt>
              <dd className="m-0 text-right text-ink">
                {rights.map((right) => RIGHT_LABELS[right]).join(", ")}
              </dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
