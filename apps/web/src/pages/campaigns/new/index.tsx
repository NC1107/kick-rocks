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
import { useNavigate, useSearchParams } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import { RequireProfile } from "../../../components/layout/RequireProfile.js";
import {
  Button,
  Callout,
  Checkbox,
  ConfirmDialog,
  EntityLink,
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
  TARGET_CATEGORY_LABELS,
  TARGET_KIND_LABELS,
} from "../../../lib/labels.js";
import { AskMe } from "../../settings/agents/AskMe.js";
import {
  channelOf,
  countByChannel,
  countNovelty,
  outcomeChannel,
  parseFilterParam,
  parseTargetIds,
  readySummary,
  waitingForPerson,
} from "../channels.js";
import { RIGHT_CHOICES, RIGHT_HELP, RIGHT_ORDER } from "../rights.js";
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
  { value: "easy", label: "Easiest first" },
  { value: "email_brokers", label: "Sites that answer by email" },
  { value: "companies", label: "Everyday companies" },
  { value: "people_search", label: "People-search sites" },
  { value: "everything", label: "Everything" },
];

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
  return parts.length > 0 ? parts.join(", ") : "Every site";
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
  const [preset, setPreset] = useState<CampaignPreset | null>("easy");
  const [chosenRights, setRights] = useState<readonly RequestRight[]>(["opt_out"]);
  const [confirming, setConfirming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(() => targetIds.length > 0);
  const pickerSummary = useRef<HTMLElement>(null);

  const filter = useMemo(() => parseFilterParam(params.get("filter")), [params]);
  const fromTargets = params.has("targets") || params.has("filter");
  const choice: Choice = filter
    ? { kind: "filter", filter }
    : targetIds.length > 0
      ? { kind: "targets" }
      : preset
        ? { kind: "preset", preset }
        : null;
  // A group or filter only opts out of sale; deleting needs named sites.
  const deleteBlocked = choice?.kind === "preset" || choice?.kind === "filter";
  const rights = deleteBlocked ? chosenRights.filter((right) => right !== "delete") : chosenRights;
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
  const previewing = preview.isPending || (body !== null && !result && !preview.isError);
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

  const useFilter = (next: TargetFilter) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.delete("targets");
        updated.set("filter", JSON.stringify(next));
        return updated;
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
      PRESET_OPTIONS.map((option) => {
        const labelled =
          option.value === "everything" && allTargets.data
            ? { ...option, label: `Everything (${formatCount(allTargets.data.length)})` }
            : option;
        return option.value === preset && result && choice?.kind === "preset"
          ? { ...labelled, meta: noveltyMeta(result.items) }
          : option.value === "easy" && easyCount !== undefined
            ? { ...labelled, meta: pluralize(easyCount, "site") }
            : labelled;
      }),
    [preset, result, choice?.kind, easyCount, allTargets.data],
  );

  const summary = canSend && result && counts ? readySummary(counts, result.items) : null;

  return (
    <>
      <PageHeader
        title="Send requests"
        description={
          <>
            Asking for{" "}
            <EntityLink to={{ kind: "profile", id: profile.id, name: profile.displayName }} />
          </>
        }
        back={fromTargets ? { to: "/targets", label: "Sites" } : "auto"}
      />

      {noMailbox ? (
        <Callout
          intent="warning"
          title="No mailbox connected"
          className="mb-4"
          action={
            <EntityLink to={{ kind: "mailbox", profileId: profile.id, address: "" }}>
              Connect a mailbox
            </EntityLink>
          }
        >
          Email requests are skipped until this profile has a mailbox to send from.
        </Callout>
      ) : null}

      <div className="flex max-w-180 flex-col gap-5 pb-5">
        <div className="flex flex-col gap-4">
          <Section label="Send to">
            {choice?.kind === "filter" ? (
              <RowGroup>
                <Row
                  title={
                    result
                      ? `${pluralize(result.items.length, "site")} match your filters`
                      : "Sites matching your filters"
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
                legend="Group of sites"
                hideLegend
                rows
                flat
                value={choice?.kind === "targets" ? null : preset}
                onValueChange={chooseGroup}
                options={presetOptions}
              />
            )}
          </Section>

          {choice?.kind === "filter" ? null : (
            <Section
              label="Or pick sites"
              {...(targetIds.length > 0 ? { count: targetIds.length } : {})}
            >
              <details
                open={pickerOpen}
                onToggle={(event) => setPickerOpen(event.currentTarget.open)}
                className="group rounded-md border border-line bg-surface"
              >
                <summary
                  ref={pickerSummary}
                  className="flex min-h-9 max-sm:min-h-11 pointer-coarse:min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3.5 text-ui text-ink transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden"
                >
                  <span>Search and pick sites</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 text-ink-3 transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-t border-line p-3">
                  <TargetPicker
                    selectedIds={targetIds}
                    onToggle={toggleTarget}
                    onUseFilter={useFilter}
                  />
                </div>
              </details>
              {targetIds.length > 0 ? (
                <RowGroup className="mt-2.5">
                  <Row
                    title={`${pluralize(targetIds.length, "site")} selected`}
                    description={`${selectedNames}${targetIds.length > 4 ? `, and ${targetIds.length - 4} more` : ""}`}
                    trailingBelowOnPhone
                    trailing={
                      <Button size="sm" onClick={clearTargets}>
                        Clear sites
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
              <div className="flex flex-col">
                {RIGHT_ORDER.map((right) => (
                  <Checkbox
                    key={right}
                    label={RIGHT_CHOICES[right]}
                    description={
                      right === "delete" && deleteBlocked
                        ? "Pick sites to delete."
                        : RIGHT_HELP[right]
                    }
                    disabled={right === "delete" && deleteBlocked}
                    checked={rights.includes(right)}
                    onChange={(event) => toggleRight(right, event.target.checked)}
                    className="items-center py-2"
                  />
                ))}
              </div>
            </fieldset>
            {rights.length === 0 ? (
              <p role="alert" className="mt-2 text-caption text-danger-text">
                Choose at least one.
              </p>
            ) : null}
          </Section>

          <AskMe />
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
                    ? "Every site you selected is skipped. Read the reasons below or choose a group instead."
                    : "Every site in this group is skipped. Pick another group or read the reasons below."}
                </Callout>
              ) : null}
              <WaitingForPersonNotice count={waiting} />
              <FirstTargets targets={firstTargets} />
              {result.sampleEmail ? (
                <EmailPreview
                  email={result.sampleEmail}
                  fromAddress={profile.primaryEmail}
                  targetId={firstRequest?.targetId ?? null}
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
          ) : null}
        </p>
        <Button variant="primary" disabled={!canSend} onClick={() => setConfirming(true)}>
          {canSend || previewing ? "Send requests" : "Nothing to send"}
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
                {rights.map((right) => RIGHT_CHOICES[right]).join(", ")}
              </dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
