import type { MailboxTestResult, MailFolder, ProviderPreset } from "@kickrocks/shared";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Button,
  Callout,
  Checkbox,
  ExternalLinkText,
  Input,
  RadioGroup,
  RowGroup,
  Section,
  Select,
  StatusShapeGlyph,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import type { StatusShape } from "../../lib/status.js";
import { BodyRow, FieldRow, GroupNote } from "../settings/rows.js";
import {
  type ConnectionForm,
  type FormErrors,
  folderChoices,
  hintForError,
  setAddress,
} from "./connection.js";

type Change = (form: ConnectionForm) => void;

export interface ProviderStepProps {
  providers: readonly ProviderPreset[];
  form: ConnectionForm;
  onChoose: (preset: ProviderPreset) => void;
  error: string | undefined;
}

/** Providers that work are choices. Those that cannot work are listed with the reason instead. */
export function ProviderStep({ providers, form, onChoose, error }: ProviderStepProps) {
  const supported = providers.filter((preset) => preset.supported);
  const unsupported = providers.filter((preset) => !preset.supported);
  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        legend="Mail provider"
        hideLegend
        rows
        error={error}
        value={form.providerId || null}
        onValueChange={(id) => {
          const preset = supported.find((candidate) => candidate.id === id);
          if (preset) onChoose(preset);
        }}
        options={supported.map((preset) => ({
          value: preset.id,
          label: preset.label,
          description: preset.notes || undefined,
        }))}
      />
      {unsupported.length > 0 ? (
        <section aria-label="Not supported yet">
          <Section label="Not supported yet" as="h3">
            <RowGroup>
              {unsupported.map((preset) => (
                <div key={preset.id} className="px-3.5 py-2.5">
                  <p className="text-ui font-medium text-ink">{preset.label}</p>
                  <p className="text-meta text-ink-3">
                    {preset.unsupportedReason ?? "Kick Rocks cannot connect to this provider."}
                  </p>
                </div>
              ))}
            </RowGroup>
          </Section>
        </section>
      ) : null}
    </div>
  );
}

export interface AccountStepProps {
  preset: ProviderPreset;
  form: ConnectionForm;
  errors: FormErrors;
  onChange: Change;
  /** A mailbox is already saved, so an empty password keeps the stored one. */
  hasSavedPassword: boolean;
}

export function AccountStep({
  preset,
  form,
  errors,
  onChange,
  hasSavedPassword,
}: AccountStepProps) {
  const [showServers, setShowServers] = useState(false);
  const generic = preset.id === "other";
  const serverErrors = Boolean(
    errors.username || errors.smtpHost || errors.smtpPort || errors.imapHost || errors.imapPort,
  );
  const serversOpen = showServers || generic || serverErrors;
  const passwordLabel = preset.appPasswordUrl || generic ? "App password" : "Password";
  const set = (change: Partial<ConnectionForm>) => onChange({ ...form, ...change });

  return (
    <div className="flex flex-col gap-4">
      <Guidance preset={preset} />
      <div>
        <RowGroup>
          <FieldRow label="Email address" error={errors.address}>
            <Input
              mono
              type="email"
              inputMode="email"
              autoComplete="off"
              value={form.address}
              onChange={(event) => onChange(setAddress(form, event.target.value))}
            />
          </FieldRow>
          <FieldRow
            label={passwordLabel}
            error={errors.password}
            help={hasSavedPassword ? "Leave empty to keep the saved password." : undefined}
          >
            <Input
              type="password"
              autoComplete="off"
              value={form.password}
              onChange={(event) => set({ password: event.target.value })}
            />
          </FieldRow>
        </RowGroup>
        <GroupNote>Stored encrypted and never shown again.</GroupNote>
      </div>

      <div>
        <button
          type="button"
          aria-expanded={serversOpen}
          aria-controls="server-settings"
          disabled={generic}
          onClick={() => setShowServers((open) => !open)}
          className="-ml-1 mb-1.5 inline-flex items-center gap-1 rounded-sm px-1 text-meta font-medium text-ink-2 hover:text-ink disabled:cursor-default disabled:hover:text-ink-2"
        >
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.5}
            className={cn("size-4 transition-transform duration-100", !serversOpen && "-rotate-90")}
          />
          Server settings
        </button>
        {serversOpen ? (
          <RowGroup id="server-settings">
            <FieldRow label="Username" error={errors.username}>
              <Input
                mono
                autoComplete="off"
                value={form.username}
                onChange={(event) => set({ username: event.target.value, usernameEdited: true })}
              />
            </FieldRow>
            <FieldRow label="Sending host (SMTP)" error={errors.smtpHost}>
              <Input
                mono
                autoComplete="off"
                autoCapitalize="none"
                value={form.smtpHost}
                onChange={(event) => set({ smtpHost: event.target.value })}
              />
            </FieldRow>
            <FieldRow label="SMTP port" error={errors.smtpPort}>
              <Input
                mono
                inputMode="numeric"
                value={form.smtpPort}
                onChange={(event) => set({ smtpPort: event.target.value })}
              />
            </FieldRow>
            <BodyRow>
              <Checkbox
                label="Secure from the first byte"
                description="On for port 465. Off for ports that upgrade the connection, such as 587."
                checked={form.smtpSecure}
                onChange={(event) => set({ smtpSecure: event.target.checked })}
              />
            </BodyRow>
            <FieldRow label="Receiving host (IMAP)" error={errors.imapHost}>
              <Input
                mono
                autoComplete="off"
                autoCapitalize="none"
                value={form.imapHost}
                onChange={(event) => set({ imapHost: event.target.value })}
              />
            </FieldRow>
            <FieldRow label="IMAP port" error={errors.imapPort}>
              <Input
                mono
                inputMode="numeric"
                value={form.imapPort}
                onChange={(event) => set({ imapPort: event.target.value })}
              />
            </FieldRow>
          </RowGroup>
        ) : null}
      </div>
    </div>
  );
}

function Guidance({ preset }: { preset: ProviderPreset }) {
  const generic = preset.id === "other";
  return (
    <Callout
      intent="info"
      title={generic ? "Use your provider's details" : `Connect ${preset.label}`}
    >
      <div className="flex flex-col gap-2">
        {preset.notes ? <p>{preset.notes}</p> : null}
        {preset.appPasswordUrl ? (
          <p>
            <ExternalLinkText href={preset.appPasswordUrl}>
              Create an app password for {preset.label}
            </ExternalLinkText>
          </p>
        ) : null}
        {preset.appPasswordUrl ? (
          <p>
            An app password lets Kick Rocks sign in without your main password, and you can revoke
            it at any time.
          </p>
        ) : null}
      </div>
    </Callout>
  );
}

export interface TestStepProps {
  form: ConnectionForm;
  preset: ProviderPreset;
  result: MailboxTestResult | null;
  testing: boolean;
  failure: ReactNode;
  onTest: () => void;
}

export function TestStep({ form, preset, result, testing, failure, onTest }: TestStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ui text-ink-2">
        Kick Rocks signs in to{" "}
        <strong className="font-mono text-meta font-medium text-ink">{form.smtpHost}</strong> to
        send and to{" "}
        <strong className="font-mono text-meta font-medium text-ink">{form.imapHost}</strong> to
        read replies. Nothing is sent.
      </p>
      <div>
        <Button variant={result ? "secondary" : "primary"} onClick={onTest} loading={testing}>
          {result ? "Test again" : "Test connection"}
        </Button>
      </div>
      {failure ? <Callout intent="danger">{failure}</Callout> : null}
      <RowGroup role="list" aria-label="Connection results" aria-live="polite">
        <ProtocolRow
          name="Sending (SMTP)"
          testing={testing}
          outcome={result?.smtp ?? null}
          preset={preset}
        />
        <ProtocolRow
          name="Receiving (IMAP)"
          testing={testing}
          outcome={result?.imap ?? null}
          preset={preset}
          extra={result?.imap.ok ? folderCount(result.imap.folders) : undefined}
        />
      </RowGroup>
    </div>
  );
}

const folderCount = (folders: readonly MailFolder[]) =>
  `${folders.length} ${folders.length === 1 ? "folder" : "folders"} found`;

interface ProtocolRowProps {
  name: string;
  testing: boolean;
  outcome: { ok: boolean; error: string | null } | null;
  preset: ProviderPreset;
  extra?: string | undefined;
}

function ProtocolRow({ name, testing, outcome, preset, extra }: ProtocolRowProps) {
  const hint = outcome && !outcome.ok ? hintForError(outcome.error, preset) : undefined;
  const shape: StatusShape = testing
    ? "running"
    : outcome
      ? outcome.ok
        ? "disc"
        : "square"
      : "ring";
  const word = testing
    ? "Checking"
    : outcome
      ? outcome.ok
        ? (extra ?? "Connected")
        : "Failed"
      : "Not tested";
  return (
    <li className="flex items-start gap-3 px-3.5 py-2.5">
      <span className="mt-[0.4375rem] shrink-0">
        <StatusShapeGlyph shape={shape} />
      </span>
      <div className="min-w-0 text-ui">
        <p className="font-medium text-ink">
          {name}
          <span
            className={cn(
              "ml-2 text-meta font-normal",
              outcome && !outcome.ok && !testing ? "text-danger-text" : "text-ink-3",
            )}
          >
            {word}
          </span>
        </p>
        {outcome && !outcome.ok ? (
          <>
            {outcome.error ? (
              <p className="mt-1 break-words text-meta text-ink-3">{outcome.error}</p>
            ) : null}
            {hint ? <p className="mt-1 text-meta text-ink">{hint}</p> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

export interface SettingsStepProps {
  form: ConnectionForm;
  preset: ProviderPreset;
  errors: FormErrors;
  folders: readonly MailFolder[];
  onChange: Change;
  onRefreshFolders: (() => void) | undefined;
  refreshing: boolean;
}

export function SettingsStep({
  form,
  preset,
  errors,
  folders,
  onChange,
  onRefreshFolders,
  refreshing,
}: SettingsStepProps) {
  const choices = folderChoices(folders, form.replyFolder);
  const cap = Number(form.dailyCap);
  const overUsual = Number.isInteger(cap) && cap > preset.defaultDailyCap;
  return (
    <div className="flex flex-col gap-4">
      <RowGroup>
        <FieldRow
          label="Reply folder"
          error={errors.replyFolder}
          help="Replies are read from this folder only."
        >
          <Select
            mono
            value={form.replyFolder}
            onChange={(event) => onChange({ ...form, replyFolder: event.target.value })}
          >
            {choices.map((choice) => (
              <option key={choice.path} value={choice.path}>
                {choice.label}
              </option>
            ))}
          </Select>
        </FieldRow>
        {onRefreshFolders ? (
          <BodyRow className="flex justify-end py-1.5">
            <Button size="sm" variant="ghost" onClick={onRefreshFolders} loading={refreshing}>
              Refresh folders
            </Button>
          </BodyRow>
        ) : null}
        <FieldRow
          label="Daily limit"
          error={errors.dailyCap}
          help={`Suggested for ${preset.label}: ${preset.defaultDailyCap}`}
        >
          <Input
            mono
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            unit="/day"
            value={form.dailyCap}
            onChange={(event) => onChange({ ...form, dailyCap: event.target.value })}
          />
        </FieldRow>
      </RowGroup>
      {overUsual ? (
        <Callout intent="warning" title="Higher than the suggested limit">
          Sending more than {preset.defaultDailyCap} a day from {preset.label} can get the account
          flagged or paused. Requests beyond the limit wait until the next day.
        </Callout>
      ) : null}
    </div>
  );
}
