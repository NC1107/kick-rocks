import type { MailboxTestResult, MailFolder, ProviderPreset } from "@kickrocks/shared";
import { ChevronDown, CircleCheck, CircleX, KeyRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  ExternalLinkText,
  Field,
  Input,
  RadioGroup,
  Select,
  Spinner,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import {
  type ConnectionForm,
  type FormErrors,
  folderChoices,
  hintForError,
  setAddress,
} from "./connection.js";

type Change = (form: ConnectionForm) => void;

interface ProviderStepProps {
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
    <div className="flex flex-col gap-6">
      <RadioGroup
        legend="Mail provider"
        hideLegend
        help="Pick the provider that hosts the email address requests go out from."
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
        <section aria-labelledby="unsupported-heading" className="border-t border-line pt-5">
          <h3 id="unsupported-heading" className="text-sm font-medium text-ink">
            Not supported yet
          </h3>
          <ul className="mt-2 flex list-none flex-col gap-3 p-0">
            {unsupported.map((preset) => (
              <li key={preset.id} className="text-sm">
                <span className="font-medium text-ink">{preset.label}</span>
                <p className="text-ink-muted">
                  {preset.unsupportedReason ?? "Kick Rocks cannot connect to this provider."}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

interface AccountStepProps {
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
    <div className="flex flex-col gap-5">
      <Guidance preset={preset} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Email address"
          error={errors.address}
          help="The address requests are sent from and replies arrive at."
        >
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={form.address}
            onChange={(event) => onChange(setAddress(form, event.target.value))}
          />
        </Field>
        <Field
          label={passwordLabel}
          error={errors.password}
          help={
            hasSavedPassword
              ? "Leave empty to keep the saved password."
              : "Stored encrypted. It is never shown again."
          }
        >
          <Input
            type="password"
            autoComplete="off"
            value={form.password}
            onChange={(event) => set({ password: event.target.value })}
          />
        </Field>
      </div>

      <div>
        <button
          type="button"
          aria-expanded={serversOpen}
          aria-controls="server-settings"
          disabled={generic}
          onClick={() => setShowServers((open) => !open)}
          className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-sm font-medium text-ink hover:text-accent disabled:cursor-default disabled:hover:text-ink"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 transition-transform", !serversOpen && "-rotate-90")}
          />
          Server settings
        </button>
        {serversOpen ? (
          <div id="server-settings" className="mt-3 grid gap-4 sm:grid-cols-6">
            <Field label="Username" error={errors.username} className="sm:col-span-6">
              <Input
                autoComplete="off"
                value={form.username}
                onChange={(event) => set({ username: event.target.value, usernameEdited: true })}
              />
            </Field>
            <Field label="Sending host (SMTP)" error={errors.smtpHost} className="sm:col-span-4">
              <Input
                autoComplete="off"
                autoCapitalize="none"
                value={form.smtpHost}
                onChange={(event) => set({ smtpHost: event.target.value })}
              />
            </Field>
            <Field label="SMTP port" error={errors.smtpPort} className="sm:col-span-2">
              <Input
                inputMode="numeric"
                value={form.smtpPort}
                onChange={(event) => set({ smtpPort: event.target.value })}
              />
            </Field>
            <Checkbox
              className="sm:col-span-6"
              label="Secure from the first byte"
              description="On for port 465. Off for ports that upgrade the connection, such as 587."
              checked={form.smtpSecure}
              onChange={(event) => set({ smtpSecure: event.target.checked })}
            />
            <Field label="Receiving host (IMAP)" error={errors.imapHost} className="sm:col-span-4">
              <Input
                autoComplete="off"
                autoCapitalize="none"
                value={form.imapHost}
                onChange={(event) => set({ imapHost: event.target.value })}
              />
            </Field>
            <Field label="IMAP port" error={errors.imapPort} className="sm:col-span-2">
              <Input
                inputMode="numeric"
                value={form.imapPort}
                onChange={(event) => set({ imapPort: event.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Guidance({ preset }: { preset: ProviderPreset }) {
  const generic = preset.id === "other";
  return (
    <Alert
      intent="info"
      title={generic ? "Use your provider's details" : `Connect ${preset.label}`}
    >
      <div className="flex flex-col gap-2">
        {preset.notes ? <p>{preset.notes}</p> : null}
        {preset.appPasswordUrl ? (
          <p className="flex items-center gap-1.5">
            <KeyRound aria-hidden="true" className="size-3.5 shrink-0" />
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
    </Alert>
  );
}

interface TestStepProps {
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
      <p className="text-base text-ink-muted">
        Kick Rocks signs in to <strong className="font-medium text-ink">{form.smtpHost}</strong> to
        send and to <strong className="font-medium text-ink">{form.imapHost}</strong> to read
        replies. Nothing is sent.
      </p>
      <div>
        <Button variant={result ? "secondary" : "primary"} onClick={onTest} loading={testing}>
          {result ? "Test again" : "Test connection"}
        </Button>
      </div>
      {failure ? <Alert intent="danger">{failure}</Alert> : null}
      <ul
        aria-label="Connection results"
        aria-live="polite"
        className="m-0 flex list-none flex-col gap-3 p-0"
      >
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
      </ul>
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
  return (
    <li
      data-tone={testing ? "neutral" : outcome ? (outcome.ok ? "green" : "red") : "neutral"}
      className="flex items-start gap-3 rounded-md border border-line p-3"
    >
      <span className="mt-0.5 shrink-0 text-tone-dot">
        {testing ? (
          <Spinner size="md" label="" />
        ) : outcome ? (
          outcome.ok ? (
            <CircleCheck aria-hidden="true" className="size-4.5" />
          ) : (
            <CircleX aria-hidden="true" className="size-4.5" />
          )
        ) : (
          <span
            aria-hidden="true"
            className="block size-4.5 rounded-full border border-line-strong"
          />
        )}
      </span>
      <div className="min-w-0 text-base">
        <p className="font-medium text-ink">
          {name}
          <span className="ml-2 text-sm font-normal text-ink-muted">
            {testing
              ? "Checking"
              : outcome
                ? outcome.ok
                  ? (extra ?? "Connected")
                  : "Failed"
                : "Not tested"}
          </span>
        </p>
        {outcome && !outcome.ok ? (
          <>
            {outcome.error ? (
              <p className="mt-1 break-words text-sm text-ink-muted">{outcome.error}</p>
            ) : null}
            {hint ? <p className="mt-1 text-sm text-ink">{hint}</p> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

interface SettingsStepProps {
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
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Field
            label="Reply folder"
            error={errors.replyFolder}
            help="Kick Rocks reads replies from this folder only. Use the inbox, or a folder your mail filter sends broker replies to."
          >
            <Select
              value={form.replyFolder}
              onChange={(event) => onChange({ ...form, replyFolder: event.target.value })}
            >
              {choices.map((choice) => (
                <option key={choice.path} value={choice.path}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </Field>
          {onRefreshFolders ? (
            <div>
              <Button size="sm" variant="ghost" onClick={onRefreshFolders} loading={refreshing}>
                Refresh folders
              </Button>
            </div>
          ) : null}
        </div>
        <Field
          label="Daily limit"
          error={errors.dailyCap}
          help={`Most requests sent in 24 hours. The suggested limit for ${preset.label} is ${preset.defaultDailyCap}.`}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={form.dailyCap}
            onChange={(event) => onChange({ ...form, dailyCap: event.target.value })}
          />
        </Field>
      </div>
      {overUsual ? (
        <Alert intent="warning" title="Higher than the suggested limit">
          Sending more than {preset.defaultDailyCap} a day from {preset.label} can get the account
          flagged or paused. Requests beyond the limit wait until the next day.
        </Alert>
      ) : null}
    </div>
  );
}
