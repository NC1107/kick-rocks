import {
  API_ROUTES,
  type CampaignBody,
  type CampaignPreset,
  type ProfileSummary,
  type RequestRight,
} from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import { RequireProfile } from "../../../components/layout/RequireProfile.js";
import {
  Alert,
  Button,
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
import { RIGHT_LABELS } from "../../../lib/labels.js";
import { channelOf, countByChannel, outcomeChannel, parseTargetIds } from "../channels.js";
import {
  AdvisoryList,
  CHANNEL_LABELS,
  ChannelReadout,
  EmailPreview,
  FirstTargets,
  SkippedList,
} from "./PreviewPanel.js";
import { useAllTargets } from "./use-all-targets.js";

const PRESET_OPTIONS: readonly RadioOption<CampaignPreset>[] = [
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
    description: "All three groups.",
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

type Choice = { kind: "preset"; preset: CampaignPreset } | { kind: "targets" } | null;

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

  const choice: Choice =
    targetIds.length > 0 ? { kind: "targets" } : preset ? { kind: "preset", preset } : null;
  const allTargets = useAllTargets();

  const body: CampaignBody | null =
    choice && rights.length > 0
      ? {
          selection: choice.kind === "targets" ? { targetIds } : { preset: choice.preset },
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
  const recipient = useApiQuery(
    API_ROUTES.targetsGet,
    firstRequest ? { params: { id: firstRequest.targetId } } : skipToken,
  );

  const toggleRight = (right: RequestRight, on: boolean) =>
    setRights((current) =>
      RIGHT_ORDER.filter((candidate) => (candidate === right ? on : current.includes(candidate))),
    );

  const clearTargets = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("targets");
        return next;
      },
      { replace: true },
    );

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
        option.value === preset && result
          ? { ...option, meta: pluralize(result.items.length, "target") }
          : option,
      ),
    [preset, result],
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
        <Alert
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
        </Alert>
      ) : null}

      <div className="grid gap-x-8 gap-y-5 pb-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex max-w-120 flex-col gap-4">
          <Section label="Who">
            {targetIds.length > 0 ? (
              <RowGroup>
                <Row
                  title={`${pluralize(targetIds.length, "target")} selected`}
                  description={`${selectedNames}${targetIds.length > 4 ? `, and ${targetIds.length - 4} more` : ""}`}
                  trailing={
                    <Button size="sm" onClick={clearTargets}>
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
                value={preset}
                onValueChange={setPreset}
                options={presetOptions}
              />
            )}
          </Section>

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
            {targetIds.length === 0 ? (
              <p className="mt-2 text-meta text-ink-3">
                Group campaigns only ask companies to stop selling. To ask for deletion, pick
                targets on the Targets page.
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
              <Alert
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
              </Alert>
            ) : (
              <ChannelReadout counts={counts} loading={body !== null && !result} />
            )}
          </Section>
          {result && counts ? (
            <>
              {work === 0 ? (
                <Alert intent="info" title="Nothing to send">
                  {targetIds.length > 0
                    ? "Every target you selected is skipped. Read the reasons below or choose a group instead."
                    : "Every target in this group is skipped. Pick another group or read the reasons below."}
                </Alert>
              ) : null}
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
                ? targetIds.length > 0
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
          <dl className="m-0 flex flex-col gap-1 font-mono text-meta">
            {(["email", "form", "manual", "scan"] as const)
              .filter((channel) => counts[channel] > 0)
              .map((channel) => (
                <div key={channel} className="flex justify-between gap-6">
                  <dt className="text-ink-2">{CHANNEL_LABELS[channel]}</dt>
                  <dd className="m-0 text-ink tabular-nums">{formatCount(counts[channel])}</dd>
                </div>
              ))}
            <div className="mt-1 flex justify-between gap-6 border-t border-line pt-2">
              <dt className="text-ink-2">asking for</dt>
              <dd className="m-0 text-ink">
                {rights.map((right) => RIGHT_TOKENS[right]).join(", ")}
              </dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
