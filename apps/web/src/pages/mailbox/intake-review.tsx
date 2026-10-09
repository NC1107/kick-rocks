import { API_ROUTES, IGNORED_KEEP_DAYS, type MailLine } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import { Button, Callout, RowGroup, Section, useToast } from "../../components/ui/index.js";
import { IGNORE_RULE_REASON } from "../../lib/admission.js";
import { formatDate, pluralize } from "../../lib/format.js";
import { BodyRow, GroupNote } from "../settings/rows.js";

const PREVIEW_ROWS = 8;

/** Who sent it, what it said and when, which is all a person needs to recognise a message. */
function MailLineText({ line, extra }: { line: MailLine; extra?: string }) {
  return (
    <div className="min-w-0">
      <p className="break-words text-ui font-medium text-ink">{line.subject || "(no subject)"}</p>
      <p className="break-all font-mono text-caption text-ink-3">
        {line.fromAddress}
        {line.receivedAt ? ` - ${formatDate(line.receivedAt)}` : ""}
      </p>
      {extra ? <p className="text-caption text-ink-2">{extra}</p> : null}
    </div>
  );
}

/**
 * The saved mail the one-time cleanup would remove, shown before anything is removed. It renders
 * nothing unless a list is waiting for the person, so any page can carry it.
 */
export function CleanupPreview({
  profileId,
  className,
  rows = PREVIEW_ROWS,
}: {
  profileId: string;
  className?: string;
  rows?: number;
}) {
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const cleanup = useApiQuery(API_ROUTES.intakeCleanup, { params: { id: profileId } });
  const invalidates = [API_ROUTES.intakeCleanup, API_ROUTES.intakeIgnored, API_ROUTES.reviewQueue];
  const confirm = useApiMutation(API_ROUTES.intakeCleanupConfirm, {
    invalidates,
    onSuccess: ({ removed }) =>
      toast.success(
        `Removed ${removed} ${pluralize(removed, "message")}`,
        `They stay in Ignored for ${IGNORED_KEEP_DAYS} days.`,
      ),
  });
  const keep = useApiMutation(API_ROUTES.intakeCleanupKeep, { invalidates });

  const data = cleanup.data;
  if (data?.state !== "review" || data.items.length === 0) return null;
  const count = data.items.length;
  const shown = showAll ? data.items : data.items.slice(0, rows);
  const busy = confirm.isPending || keep.isPending;

  return (
    <Section label="Saved mail to remove" count={count} {...(className ? { className } : {})}>
      <RowGroup data-testid="cleanup-preview">
        <BodyRow>
          <p className="text-meta text-ink-2">
            Kick Rocks saved these before it started choosing what to keep. None is tied to a
            request. Nothing is removed until you confirm. The mail stays in your mailbox.
          </p>
        </BodyRow>
        {shown.map((line) => (
          <BodyRow key={line.id}>
            <MailLineText line={line} />
          </BodyRow>
        ))}
        {count > rows ? (
          <BodyRow>
            <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${count}`}
            </Button>
          </BodyRow>
        ) : null}
        <BodyRow className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            loading={keep.isPending}
            onClick={() => keep.mutate({ params: { id: profileId } })}
          >
            Keep all
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            loading={confirm.isPending}
            onClick={() => confirm.mutate({ params: { id: profileId } })}
          >
            {`Confirm removal of ${count}`}
          </Button>
        </BodyRow>
      </RowGroup>
      {confirm.error || keep.error ? (
        <Callout intent="danger" className="mt-2">
          {errorMessage(confirm.error ?? keep.error)}
        </Callout>
      ) : null}
    </Section>
  );
}

/** Mail the person confirmed for removal, kept for a while with a way back. */
export function IgnoredMail({
  profileId,
  showEmpty = false,
  className,
}: {
  profileId: string;
  showEmpty?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const ignored = useApiQuery(API_ROUTES.intakeIgnored, { params: { id: profileId } });
  const takeIn = useApiMutation(API_ROUTES.intakeIgnoredTakeIn, {
    invalidates: [API_ROUTES.intakeIgnored, API_ROUTES.reviewQueue],
    onSuccess: () => toast.success("Taken in", "It is in Review."),
  });

  const items = ignored.data?.items ?? [];
  if (!ignored.data || (items.length === 0 && !showEmpty)) return null;

  return (
    <Section label="Ignored" count={items.length} {...(className ? { className } : {})}>
      {items.length === 0 ? (
        <p className="text-ui text-ink-2">Nothing ignored.</p>
      ) : (
        <RowGroup data-testid="ignored-mail">
          {items.map((item) => (
            <BodyRow
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"
            >
              <MailLineText line={item} extra={`Kept until ${formatDate(item.keptUntil)}`} />
              <Button
                size="sm"
                aria-label={`Take in ${item.subject}`}
                loading={takeIn.isPending && takeIn.variables?.params.messageId === item.id}
                onClick={() => takeIn.mutate({ params: { id: profileId, messageId: item.id } })}
              >
                Take in
              </Button>
            </BodyRow>
          ))}
        </RowGroup>
      )}
      {items.length > 0 ? (
        <GroupNote>{`Kick Rocks deletes its copy ${IGNORED_KEEP_DAYS} days after you confirmed.`}</GroupNote>
      ) : null}
      {takeIn.error ? (
        <Callout intent="danger" className="mt-2">
          {errorMessage(takeIn.error)}
        </Callout>
      ) : null}
    </Section>
  );
}

/**
 * For a week after the upgrade, the mail the new rules passed over that the old ones would have
 * kept, so a reply wrongly passed over on real mail is seen and can be taken in.
 */
export function ShadowReport({ profileId, className }: { profileId: string; className?: string }) {
  const toast = useToast();
  const shadow = useApiQuery(API_ROUTES.intakeShadow, { params: { id: profileId } });
  const takeIn = useApiMutation(API_ROUTES.intakeShadowTakeIn, {
    invalidates: [API_ROUTES.intakeShadow, API_ROUTES.reviewQueue],
    onSuccess: () => toast.success("Taken in", "It is in Review."),
    // A message that left the mailbox is dropped from the list, so the list is read again.
    onError: () => void shadow.refetch(),
  });
  const dismiss = useApiMutation(API_ROUTES.intakeShadowDismiss, {
    invalidates: [API_ROUTES.intakeShadow],
  });

  const report = shadow.data;
  if (!report?.active) return null;

  return (
    <Section
      label="Passed over this week"
      count={report.items.length}
      {...(className ? { className } : {})}
    >
      <RowGroup data-testid="shadow-report">
        <BodyRow>
          <p className="text-meta text-ink-2">
            {`The old rules kept every message. This lists mail the new rules passed over that could be a reply, until ${formatDate(report.until ?? "")}. Kick Rocks notes only the sender, subject and date.`}
          </p>
        </BodyRow>
        {report.items.length === 0 ? (
          <BodyRow>
            <p className="text-meta text-ink-3">Nothing passed over yet that could be a reply.</p>
          </BodyRow>
        ) : null}
        {report.items.map((line) => (
          <BodyRow
            key={line.id}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"
          >
            <MailLineText line={line} extra={IGNORE_RULE_REASON[line.rule]} />
            <Button
              size="sm"
              aria-label={`Take in ${line.subject}`}
              loading={takeIn.isPending && takeIn.variables?.params.shadowId === line.id}
              onClick={() => takeIn.mutate({ params: { id: profileId, shadowId: line.id } })}
            >
              Take in
            </Button>
          </BodyRow>
        ))}
        <BodyRow className="flex justify-end">
          <Button
            variant="ghost"
            loading={dismiss.isPending}
            onClick={() => dismiss.mutate({ params: { id: profileId } })}
          >
            Dismiss report
          </Button>
        </BodyRow>
      </RowGroup>
      {takeIn.error || dismiss.error ? (
        <Callout intent="danger" className="mt-2">
          {errorMessage(takeIn.error ?? dismiss.error)}
        </Callout>
      ) : null}
    </Section>
  );
}
