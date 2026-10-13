import {
  API_ROUTES,
  type CompanyMail,
  type FoundMessage,
  type IntakeSender,
  type Mailbox,
  type ProviderPreset,
} from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Button,
  Callout,
  Checkbox,
  Disclosure,
  Input,
  RadioGroup,
  RowGroup,
  Section,
  Select,
} from "../../components/ui/index.js";
import { ADMISSION_REASON } from "../../lib/admission.js";
import { BodyRow, FieldRow, GroupNote } from "../settings/rows.js";
import { CleanupPreview, IgnoredMail, ShadowReport } from "./intake-review.js";

const RULES = [
  "Replies to the mail Kick Rocks sent for your requests.",
  "Mail that names the reference of one of your requests.",
  "Bounce messages for mail Kick Rocks sent.",
  "The confirmation email a form you submitted is waiting for.",
  "Mail from brokers with an open request, minus newsletters and ads.",
  "Mail from companies with an open request, if about privacy (change below).",
  "Mail from anyone that names a target with an open request and is about your data.",
  "Mail to your reply address (once on) naming such a target.",
  "Mail from senders you add below.",
  "Mail matching no request is kept for review, never applied.",
] as const;

const COMPANY_MAIL_OPTIONS = [
  { value: "privacy_only", label: "Only mail about privacy requests" },
  { value: "all", label: "Everything except newsletters and ads" },
] as const;

/** The domain of an address, which is what "always take in" is offered for. */
function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

interface IntakeSectionProps {
  profileId: string;
  mailbox: Mailbox;
  provider: ProviderPreset | undefined;
}

/** What Kick Rocks takes in from the mailbox, with the controls that change it. */
export function IntakeSection({ profileId, mailbox, provider }: IntakeSectionProps) {
  const { hash } = useLocation();
  const [rulesOpen, setRulesOpen] = useState(false);
  // The link from the notice and from Settings names this section, but the page renders after the jump.
  useEffect(() => {
    if (hash === "#intake") document.getElementById("intake")?.scrollIntoView?.({ block: "start" });
  }, [hash]);
  return (
    <div id="intake" className="mt-8 scroll-mt-4 flex flex-col gap-6">
      <Section label="Mail intake">
        <RowGroup>
          <BodyRow>
            <p className="text-meta font-medium text-ink">Request mail only</p>
          </BodyRow>
          {mailbox.lastPolledAt ? (
            <BodyRow>
              <p className="text-meta text-ink-2" data-testid="last-check">
                <span className="font-mono tabular-nums">
                  {mailbox.lastPollScanned} checked · {mailbox.lastPollKept} kept
                </span>
              </p>
            </BodyRow>
          ) : null}
        </RowGroup>
        <Disclosure
          title="What counts"
          open={rulesOpen}
          onOpenChange={setRulesOpen}
          className="mt-2"
        >
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-meta text-ink-2">
            {RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </Disclosure>
      </Section>
      <CleanupPreview profileId={profileId} />
      <ShadowReport profileId={profileId} />
      <CompanyMailSetting profileId={profileId} mailbox={mailbox} />
      {provider?.plusAddressing ? <ReplyAddress profileId={profileId} mailbox={mailbox} /> : null}
      <AlwaysTakeIn profileId={profileId} />
      <FindMissingReply profileId={profileId} />
      <IgnoredMail profileId={profileId} showEmpty />
    </div>
  );
}

function CompanyMailSetting({ profileId, mailbox }: { profileId: string; mailbox: Mailbox }) {
  const save = useApiMutation(API_ROUTES.mailboxIntake, { invalidates: [API_ROUTES.profilesGet] });
  return (
    <Section label="Company mail" as="h3">
      <RadioGroup
        legend="Company mail"
        hideLegend
        rows
        value={mailbox.companyMail}
        onValueChange={(companyMail: CompanyMail) =>
          save.mutate({ params: { id: profileId }, body: { companyMail } })
        }
        options={COMPANY_MAIL_OPTIONS.map((option) => ({ ...option }))}
      />
      <GroupNote>Newsletters and ads are never taken in.</GroupNote>
      {save.error ? (
        <Callout intent="danger" className="mt-2">
          {errorMessage(save.error)}
        </Callout>
      ) : null}
    </Section>
  );
}

function ReplyAddress({ profileId, mailbox }: { profileId: string; mailbox: Mailbox }) {
  const [problem, setProblem] = useState<string | null>(null);
  const enable = useApiMutation(API_ROUTES.mailboxAliasEnable, {
    invalidates: [API_ROUTES.profilesGet],
    onSuccess: (result) => setProblem(result.problem),
  });
  const disable = useApiMutation(API_ROUTES.mailboxAliasDisable, {
    invalidates: [API_ROUTES.profilesGet],
    onSuccess: () => setProblem(null),
  });
  const on = mailbox.replyAlias !== null;

  return (
    <Section label="Reply address" as="h3">
      <RowGroup>
        <BodyRow>
          <Checkbox
            label="Ask brokers to reply to a separate address"
            description={
              <>
                Requests are still sent from your address.{" "}
                {mailbox.replyAlias ? (
                  <>
                    Replies go to <span className="font-mono">{mailbox.replyAlias}</span>
                  </>
                ) : (
                  "Replies go to a tagged form of your address"
                )}
                , which lands in this same mailbox. Brokers will see this address. Kick Rocks sends
                a test mail to prove it works before using it.
              </>
            }
            checked={on}
            disabled={enable.isPending || disable.isPending}
            onChange={(event) =>
              event.target.checked
                ? enable.mutate({ params: { id: profileId } })
                : disable.mutate({ params: { id: profileId } })
            }
          />
        </BodyRow>
        {on && mailbox.replyAliasVerified ? (
          <BodyRow>
            <p className="text-meta text-ink-2">
              The test mail arrived, so replies to this address reach the mailbox.
            </p>
          </BodyRow>
        ) : null}
      </RowGroup>
      {on && !mailbox.replyAliasVerified ? (
        <Callout
          intent="warning"
          title="The address is not in use yet"
          className="mt-2"
          action={
            <Button
              size="sm"
              loading={enable.isPending}
              onClick={() => enable.mutate({ params: { id: profileId } })}
            >
              Send a test
            </Button>
          }
        >
          {problem ?? "No test mail has reached this mailbox yet."}
        </Callout>
      ) : null}
      {enable.error ? (
        <Callout intent="danger" className="mt-2">
          {errorMessage(enable.error)}
        </Callout>
      ) : null}
    </Section>
  );
}

/** The companies the person has a request with, for choosing who a sender belongs to. */
function useRequestTargets(profileId: string) {
  const list = useApiQuery(API_ROUTES.requestsList, {
    params: { id: profileId },
    query: { page: 1, pageSize: 100 },
  });
  const seen = new Map<string, string>();
  for (const request of list.data?.items ?? []) seen.set(request.target.id, request.target.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function AlwaysTakeIn({ profileId }: { profileId: string }) {
  const targets = useRequestTargets(profileId);
  const senders = useApiQuery(API_ROUTES.intakeSendersList, { params: { id: profileId } });
  const [targetId, setTargetId] = useState("");
  const [value, setValue] = useState("");
  const add = useApiMutation(API_ROUTES.intakeSenderAdd, {
    invalidates: [API_ROUTES.intakeSendersList],
    onSuccess: () => setValue(""),
  });
  const remove = useApiMutation(API_ROUTES.intakeSenderRemove, {
    invalidates: [API_ROUTES.intakeSendersList],
  });
  const chosen = targetId || targets[0]?.id || "";

  return (
    <Section label="Always take in" as="h3">
      <RowGroup>
        {(senders.data?.senders ?? []).map((sender: IntakeSender) => (
          <BodyRow key={sender.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-all text-meta text-ink">
              <span className="font-mono">{sender.value}</span>
              <span className="text-ink-3"> for {sender.targetName}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${sender.value}`}
              loading={remove.isPending && remove.variables?.params.senderId === sender.id}
              onClick={() => remove.mutate({ params: { id: profileId, senderId: sender.id } })}
            >
              Remove
            </Button>
          </BodyRow>
        ))}
        {senders.data && senders.data.senders.length === 0 ? (
          <BodyRow>
            <p className="text-meta text-ink-3">No senders added.</p>
          </BodyRow>
        ) : null}
        <FieldRow label="Company or broker">
          <Select
            value={chosen}
            disabled={targets.length === 0}
            onChange={(event) => setTargetId(event.target.value)}
          >
            {targets.length === 0 ? <option value="">No requests yet</option> : null}
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </Select>
        </FieldRow>
        <FieldRow label="Domain or address">
          <Input
            mono
            value={value}
            placeholder="reports.example.org"
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
        </FieldRow>
        <BodyRow className="flex justify-end">
          <Button
            variant="primary"
            disabled={!chosen || value.trim().length < 3}
            loading={add.isPending}
            onClick={() =>
              add.mutate({ params: { id: profileId }, body: { targetId: chosen, value } })
            }
          >
            Add sender
          </Button>
        </BodyRow>
      </RowGroup>
      <GroupNote>Newsletters and ads skipped; links and senders are not trusted.</GroupNote>
      {add.error ? (
        <Callout intent="danger" className="mt-2">
          {errorMessage(add.error)}
        </Callout>
      ) : null}
    </Section>
  );
}

function FindMissingReply({ profileId }: { profileId: string }) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(() => isoDay(-30));
  const [to, setTo] = useState(() => isoDay(0));
  const find = useApiMutation(API_ROUTES.mailboxFind);
  const result = find.data;

  return (
    <Section label="Find a missing reply" as="h3">
      <RowGroup>
        <FieldRow label="Sender, domain or reference">
          <Input
            mono
            value={query}
            placeholder="privacy@example.org or KR-7K3M9Q"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </FieldRow>
        <FieldRow label="From">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </FieldRow>
        <FieldRow label="To">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </FieldRow>
        <BodyRow className="flex justify-end">
          <Button
            variant="primary"
            disabled={query.trim().length < 2 || !from || !to}
            loading={find.isPending}
            onClick={() => find.mutate({ params: { id: profileId }, body: { query, from, to } })}
          >
            Search mailbox
          </Button>
        </BodyRow>
      </RowGroup>
      <GroupNote>Searches live; nothing is saved unless you take a message in.</GroupNote>
      {find.error ? (
        <Callout intent="danger" className="mt-2">
          {errorMessage(find.error)}
        </Callout>
      ) : null}
      {result && !result.searched ? (
        <Callout intent="warning" className="mt-2">
          Your mail server cannot search, so nothing could be listed.
        </Callout>
      ) : null}
      {result?.searched && result.messages.length === 0 ? (
        <GroupNote>No messages matched in that period.</GroupNote>
      ) : null}
      {result?.searched && result.messages.length > 0 ? (
        <div className="mt-3">
          <RowGroup>
            {result.messages.map((message) => (
              <FoundRow
                key={`${message.uidValidity}:${message.uid}`}
                profileId={profileId}
                message={message}
              />
            ))}
          </RowGroup>
        </div>
      ) : null}
    </Section>
  );
}

function FoundRow({ profileId, message }: { profileId: string; message: FoundMessage }) {
  const targets = useRequestTargets(profileId);
  const [targetId, setTargetId] = useState("");
  const [taken, setTaken] = useState(message.stored);
  const take = useApiMutation(API_ROUTES.mailboxTakeIn, {
    invalidates: [API_ROUTES.reviewQueue],
    onSuccess: () => setTaken(true),
  });
  const always = useApiMutation(API_ROUTES.intakeSenderAdd, {
    invalidates: [API_ROUTES.intakeSendersList],
  });
  const domain = domainOf(message.fromAddress);
  const chosen = targetId || targets[0]?.id || "";
  const targetName = targets.find((target) => target.id === chosen)?.name ?? "";

  return (
    <BodyRow className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="break-words text-ui font-medium text-ink">
            {message.subject || "(no subject)"}
          </p>
          <p className="break-all font-mono text-caption text-ink-3">
            {message.fromAddress}
            {message.receivedAt ? ` - ${message.receivedAt.slice(0, 10)}` : ""}
          </p>
          <p className="text-caption text-ink-2">
            {message.admittedBy
              ? `Kick Rocks would keep it. ${ADMISSION_REASON[message.admittedBy]}.`
              : "Kick Rocks would leave it in your mailbox."}
          </p>
        </div>
        {taken ? (
          <span className="text-meta text-ink-2">Taken in</span>
        ) : (
          <Button
            size="sm"
            loading={take.isPending}
            aria-label={`Take in ${message.subject}`}
            onClick={() =>
              take.mutate({
                params: { id: profileId },
                body: { uid: message.uid, uidValidity: message.uidValidity },
              })
            }
          >
            Take in
          </Button>
        )}
      </div>
      {take.error ? <Callout intent="danger">{errorMessage(take.error)}</Callout> : null}
      {taken && !always.isSuccess ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Company or broker for this sender"
            className="min-w-48"
            value={chosen}
            disabled={targets.length === 0}
            onChange={(event) => setTargetId(event.target.value)}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!chosen}
            loading={always.isPending}
            onClick={() =>
              always.mutate({
                params: { id: profileId },
                body: { targetId: chosen, value: domain },
              })
            }
          >
            {`Always take in mail from ${domain} for ${targetName || "this company"}`}
          </Button>
        </div>
      ) : null}
      {always.isSuccess ? (
        <p className="text-meta text-ink-2">
          Mail from {domain} will be taken in for {always.data.targetName}.
        </p>
      ) : null}
    </BodyRow>
  );
}
