import {
  API_ROUTES,
  type CampaignBody,
  type PreviewBasis,
  type ProfileSummary,
  type RequestRight,
  type TargetDetail,
} from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import { useBreadcrumbTail } from "../../../components/layout/breadcrumb-context.js";
import { RequireProfile } from "../../../components/layout/RequireProfile.js";
import {
  Button,
  Callout,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  EntityLink,
  LinkButton,
  PageHeader,
  RowGroup,
  Section,
  Skeleton,
  useToast,
} from "../../../components/ui/index.js";
import { pluralize } from "../../../lib/format.js";
import { RIGHT_LABELS, SKIP_REASON_LABELS } from "../../../lib/labels.js";
import { paths } from "../../../lib/paths.js";
import { EmailPreview } from "../../campaigns/new/PreviewPanel.js";
import { RIGHT_HELP, RIGHT_ORDER } from "../../campaigns/rights.js";

export function Component() {
  const { id } = useParams();
  const target = useApiQuery(API_ROUTES.targetsGet, id ? { params: { id } } : skipToken);
  useBreadcrumbTail(target.data?.name);

  if (target.isPending) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (target.isError) {
    return (
      <EmptyState
        title="Target not found."
        description={errorMessage(target.error)}
        actions={<LinkButton to="/targets">Back to targets</LinkButton>}
      />
    );
  }
  return (
    <RequireProfile>
      {(profile) => <Remove target={target.data} profile={profile} />}
    </RequireProfile>
  );
}

/** Which law makes the target answer and by when, or the target's own policy when no law applies. */
function basisLine(basis: PreviewBasis): string {
  const days = pluralize(basis.responseDays, "day");
  if (basis.kind === "policy") {
    return `Based on their own privacy policy. They should answer within ${days}.`;
  }
  const law = [basis.name, basis.citation].filter(Boolean).join(", ");
  return `Based on ${law}. They must answer within ${days}.`;
}

function Remove({ target, profile }: { target: TargetDetail; profile: ProfileSummary }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [rights, setRights] = useState<readonly RequestRight[]>(["opt_out"]);
  const [confirming, setConfirming] = useState(false);
  const settings = useApiQuery(API_ROUTES.settingsGet);

  const body: CampaignBody | null =
    rights.length > 0 ? { selection: { targetIds: [target.id] }, rights: [...rights] } : null;
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

  const outcome = preview.data?.items[0];
  const scanFirst = outcome?.outcome === "scan_started";
  const formTask = !scanFirst && target.contactMethod === "form";

  const create = useApiMutation(API_ROUTES.campaignsCreate, {
    invalidates: [
      API_ROUTES.requestsList,
      API_ROUTES.dashboardGet,
      API_ROUTES.reviewQueue,
      API_ROUTES.scansList,
    ],
    onSuccess: (result) => {
      setConfirming(false);
      const scan = result.counts.scan_started > 0;
      toast.success(
        scan ? "Scan started" : formTask ? "Form task added" : "Request queued to send",
      );
      // Replaced, so back from the result returns to the target and not to a form that has already gone.
      navigate(scan ? "/review" : "/requests", { replace: true });
    },
    onError: () => setConfirming(false),
  });

  const skipped = outcome?.outcome === "skipped" ? outcome : null;
  const email = preview.data?.sampleEmail ?? null;
  const basis = preview.data?.basis ?? null;
  const canSend = body !== null && outcome !== undefined && !skipped && !preview.isPending;

  const formOnly = target.contactMethod === "form" && !target.needsRecord;
  const hasRecipe = target.recipes.some(
    (recipe) =>
      recipe.purpose === "remove" && recipe.status === "active" && recipe.health !== "broken",
  );
  const agentSeen = settings.data ? settings.data.worker.model !== null : true;
  const needsId = target.requirements.includes("id_upload") && rights.includes("delete");

  const sendLabel = scanFirst ? "Start scan" : formTask ? "Create request" : "Send request";

  const toggleRight = (right: RequestRight, on: boolean) =>
    setRights((current) =>
      RIGHT_ORDER.filter((candidate) => (candidate === right ? on : current.includes(candidate))),
    );

  return (
    <>
      <PageHeader
        title={`Remove my data from ${target.name}`}
        description={`Asking for ${profile.displayName}`}
        back={{ to: paths.target(target.id), label: target.name }}
      />

      <div className="flex max-w-180 flex-col gap-4 pb-5">
        {!profile.mailboxConnected && !formOnly ? (
          <Callout
            intent="warning"
            title="No mailbox connected"
            action={
              <EntityLink
                to={{ kind: "mailbox", profileId: profile.id, address: profile.primaryEmail ?? "" }}
              >
                Connect a mailbox
              </EntityLink>
            }
          >
            The email is skipped until this profile has a mailbox to send from.
          </Callout>
        ) : null}
        {scanFirst ? (
          <Callout intent="info" title="Scanned first">
            Kick Rocks searches {target.name} for {profile.displayName} first. You confirm the
            record in Review, then the request goes.
          </Callout>
        ) : null}
        {formOnly ? (
          <Callout intent="info" title="Web form only">
            {target.name} has no email address for this. The request is a form to fill in.
          </Callout>
        ) : null}
        {formOnly && !hasRecipe && !agentSeen ? (
          <Callout intent="warning" title="No agent connected">
            Nothing fills in this form for you. It waits in Review until you do it by hand or
            connect an agent.
          </Callout>
        ) : null}
        {needsId ? (
          <Callout intent="warning" title="Asks for ID">
            They want a photo of ID. Nothing uploads ID for you, so you add it yourself.
          </Callout>
        ) : null}
        {outcome?.detail && !skipped ? (
          <Callout intent="info" title="Worth knowing">
            {outcome.detail}
          </Callout>
        ) : null}
        {skipped ? (
          <Callout intent="danger" title="Nothing would go out">
            {skipped.reason ? SKIP_REASON_LABELS[skipped.reason] : "Skipped"}
            {skipped.detail ? `. ${skipped.detail}` : ""}
          </Callout>
        ) : null}

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
          {rights.length === 0 ? (
            <p role="alert" className="mt-2 text-caption text-danger-text">
              Choose at least one.
            </p>
          ) : null}
        </Section>

        {preview.isError ? (
          <Callout intent="danger" title="Could not build the preview">
            {errorMessage(preview.error)}
          </Callout>
        ) : null}
        {email ? (
          <EmailPreview
            email={email}
            fromAddress={profile.primaryEmail}
            targetName={target.name}
            toAddress={target.privacyEmail}
          />
        ) : null}
        {basis && !skipped ? <p className="text-meta text-ink-2">{basisLine(basis)}</p> : null}
      </div>

      <div
        data-testid="send-bar"
        className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-canvas py-3"
      >
        <p className="min-w-0 text-meta" aria-live="polite">
          {create.isError ? (
            <span className="text-danger-text">
              Could not send the request. {errorMessage(create.error)}
            </span>
          ) : null}
        </p>
        <Button variant="primary" disabled={!canSend} onClick={() => setConfirming(true)}>
          {sendLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={
          scanFirst
            ? `Scan ${target.name}?`
            : formTask
              ? `Ask ${target.name} through its form?`
              : `Send to ${target.name}?`
        }
        description={
          scanFirst
            ? "Nothing is sent yet. You confirm the record it finds in Review, then the request goes."
            : formTask
              ? "This adds a form task to Review. Nothing is emailed, and you can stop it before it is filled in."
              : "The email goes out within your daily limit. You can stop it until it has gone."
        }
        confirmLabel={sendLabel}
        loading={create.isPending}
        onConfirm={() => body && create.mutate({ params: { id: profile.id }, body })}
      />
    </>
  );
}
