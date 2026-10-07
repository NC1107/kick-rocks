import {
  API_ROUTES,
  type CampaignBody,
  type CampaignPreset,
  type ProfileSummary,
  type RequestRight,
} from "@kickrocks/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import { RequireProfile } from "../../../components/layout/RequireProfile.js";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  PageHeader,
  RadioGroup,
  type RadioOption,
  useToast,
} from "../../../components/ui/index.js";
import { pluralize } from "../../../lib/format.js";
import { RIGHT_LABELS } from "../../../lib/labels.js";
import { countByChannel, parseTargetIds } from "../channels.js";
import { ChannelTiles, CountsSkeleton, EmailPreview, SkippedList } from "./PreviewPanel.js";
import { useAllTargets } from "./use-all-targets.js";

const PRESET_OPTIONS: readonly RadioOption<CampaignPreset>[] = [
  {
    value: "email_brokers",
    label: "Data brokers with an email address",
    description: "Marketing and registered brokers that take requests by email.",
  },
  {
    value: "companies",
    label: "Everyday companies",
    description: "Retailers, banks, carriers, and other businesses that may sell your data.",
  },
  {
    value: "people_search",
    label: "People-search sites",
    description:
      "Kick Rocks scans for your records first. Nothing is removed until you confirm each one.",
  },
  {
    value: "everything",
    label: "Everything",
    description: "Brokers, companies, and people-search sites together.",
  },
];

const RIGHT_HELP: Record<RequestRight, string> = {
  opt_out: "Ask them to stop selling or sharing your information.",
  delete: "Ask them to erase what they hold about you.",
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
  const [rights, setRights] = useState<readonly RequestRight[]>(["opt_out", "delete"]);
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
  const firstRequest = result?.items.find((item) => item.outcome === "request_created");
  const canSend = body !== null && work > 0 && !preview.isPending;
  const noMailbox = !profile.mailboxConnected;

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

  return (
    <>
      <PageHeader
        title="New campaign"
        description={`Ask many targets at once to stop selling ${profile.displayName}'s data.`}
        back={{ to: "/requests", label: "Requests" }}
      />

      <div className="flex flex-col gap-5">
        {noMailbox ? (
          <Alert
            intent="warning"
            title="No mailbox connected"
            action={
              <Link
                to={`/profiles/${encodeURIComponent(profile.id)}/mailbox`}
                className="text-accent underline underline-offset-2"
              >
                Connect a mailbox
              </Link>
            }
          >
            Email requests are skipped until this profile has a mailbox to send from.
          </Alert>
        ) : null}

        <Card>
          <CardHeader
            title="Who to ask"
            description="Pick a group to see exactly what would happen before anything is sent."
          />
          {targetIds.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-base text-ink">
                <span className="font-medium">
                  {pluralize(targetIds.length, "target")} selected
                </span>
                <span className="block break-words text-sm text-ink-muted">
                  {selectedNames}
                  {targetIds.length > 4 ? `, and ${targetIds.length - 4} more` : ""}
                </span>
              </p>
              <Button onClick={clearTargets}>Choose a group instead</Button>
            </div>
          ) : (
            <RadioGroup
              legend="Group of targets"
              hideLegend
              value={preset}
              onValueChange={setPreset}
              options={PRESET_OPTIONS}
            />
          )}
        </Card>

        <Card>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1 p-0 text-lg font-semibold text-ink">What to ask for</legend>
            <p className="mb-4 text-sm text-ink-muted">
              Each email names the law that applies to where you live.
            </p>
            <div className="flex flex-col gap-3">
              {RIGHT_ORDER.map((right) => (
                <Checkbox
                  key={right}
                  label={RIGHT_LABELS[right]}
                  description={RIGHT_HELP[right]}
                  checked={rights.includes(right)}
                  onChange={(event) => toggleRight(right, event.target.checked)}
                />
              ))}
            </div>
            {rights.length === 0 ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                Choose at least one.
              </p>
            ) : null}
          </fieldset>
        </Card>

        {body === null ? null : preview.isError ? (
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
        ) : preview.isPending || !result || !counts ? (
          <CountsSkeleton />
        ) : (
          <section aria-label="Preview" className="flex flex-col gap-5">
            <ChannelTiles counts={counts} />
            {work === 0 ? (
              <Alert intent="info" title="Nothing to send">
                Every target in this group is skipped. Pick another group or read the reasons below.
              </Alert>
            ) : null}
            {result.sampleEmail ? (
              <EmailPreview
                email={result.sampleEmail}
                fromAddress={profile.primaryEmail}
                targetName={firstRequest?.targetName ?? null}
              />
            ) : null}
            <SkippedList items={result.items} />
          </section>
        )}

        <Card className="sticky bottom-3 z-10 shadow-pop">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-base text-ink-muted" aria-live="polite">
              {canSend
                ? `Ready to send ${pluralize(result?.counts.request_created ?? 0, "request")}${
                    (result?.counts.scan_started ?? 0) > 0
                      ? ` and start ${pluralize(result?.counts.scan_started ?? 0, "scan")}`
                      : ""
                  }.`
                : body === null
                  ? "Pick a group and at least one right to see a preview."
                  : "Nothing to send yet."}
            </p>
            <Button variant="primary" disabled={!canSend} onClick={() => setConfirming(true)}>
              Send requests
            </Button>
          </div>
          {create.isError ? (
            <div className="mt-3">
              <Alert intent="danger" title="Could not send the requests">
                {errorMessage(create.error)}
              </Alert>
            </div>
          ) : null}
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send these requests?"
        description="Emails go out one at a time from your mailbox, spaced out and within its daily limit. You can cancel any request afterwards."
        confirmLabel="Send requests"
        loading={create.isPending}
        onConfirm={() => body && create.mutate({ params: { id: profile.id }, body })}
      >
        {counts ? (
          <ul className="m-0 list-disc pl-5 text-base text-ink">
            {counts.email > 0 ? <li>{pluralize(counts.email, "email")}</li> : null}
            {counts.form > 0 ? <li>{pluralize(counts.form, "web form")}</li> : null}
            {counts.scan > 0 ? (
              <li>{pluralize(counts.scan, "scan")} to find your records</li>
            ) : null}
          </ul>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
