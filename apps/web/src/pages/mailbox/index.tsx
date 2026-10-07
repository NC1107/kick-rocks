import {
  API_ROUTES,
  type MailboxTestResult,
  type MailFolder,
  type ProfileDetail,
  type ProviderPreset,
} from "@kickrocks/shared";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiRequestError, errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  PageHeader,
  Section,
  Skeleton,
  StatusShapeGlyph,
  useToast,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import {
  applyPreset,
  type ConnectionForm,
  connectionBody,
  connectionSignature,
  emptyForm,
  type FormErrors,
  formFromMailbox,
  saveBody,
  suggestedFolder,
  validateConnection,
  validateSettings,
} from "./connection.js";
import { MailboxFacts, SendPauseAlert, useProviderLabel } from "./mailbox-card.js";
import { AccountStep, ProviderStep, SettingsStep, TestStep } from "./steps.js";

const STEPS = ["Provider", "Account", "Test", "Settings"] as const;
type StepIndex = 0 | 1 | 2 | 3;

export function Component() {
  const { id = "" } = useParams();
  const profile = useApiQuery(API_ROUTES.profilesGet, { params: { id } });
  const providers = useApiQuery(API_ROUTES.mailProviders, { staleTime: 5 * 60_000 });

  const back = { to: "/profiles", label: "Profiles" };

  if (profile.isPending || providers.isPending) {
    return (
      <div aria-busy="true" className="flex max-w-3xl flex-col gap-4">
        <div>
          <Skeleton className="mb-2 h-4 w-20" />
          <Skeleton className="h-7 w-56" />
        </div>
        <Skeleton className="h-72 w-full rounded-md" />
      </div>
    );
  }

  const failure = profile.error ?? providers.error;
  if (failure || !profile.data || !providers.data) {
    const missing = failure instanceof ApiRequestError && failure.status === 404;
    return (
      <>
        <PageHeader title="Mailbox" back={back} />
        {missing ? (
          <EmptyState
            title="That profile does not exist"
            description="It may have been deleted."
            actions={
              <LinkButton to="/profiles" variant="primary">
                Back to profiles
              </LinkButton>
            }
          />
        ) : (
          <Callout
            intent="danger"
            title="Could not load the mailbox"
            action={
              <Button
                size="sm"
                onClick={() => {
                  void profile.refetch();
                  void providers.refetch();
                }}
              >
                Try again
              </Button>
            }
          >
            {errorMessage(failure)}
          </Callout>
        )}
      </>
    );
  }

  return <MailboxPage profile={profile.data} providers={providers.data.providers} />;
}

function MailboxPage({
  profile,
  providers,
}: {
  profile: ProfileDetail;
  providers: readonly ProviderPreset[];
}) {
  const [editing, setEditing] = useState(false);
  const { mailbox } = profile;
  const showWizard = editing || !mailbox;

  return (
    <>
      <PageHeader
        title={mailbox && !editing ? "Mailbox" : mailbox ? "Edit mailbox" : "Connect a mailbox"}
        description={
          mailbox && !editing ? `Requests for ${profile.displayName} go out from here` : undefined
        }
        back={{ to: `/profiles/${profile.id}`, label: profile.displayName }}
      />
      <div className="max-w-3xl">
        {showWizard ? (
          <Wizard
            profile={profile}
            providers={providers}
            onCancel={mailbox ? () => setEditing(false) : undefined}
            onSaved={() => setEditing(false)}
          />
        ) : (
          <ConnectedMailbox profile={profile} onEdit={() => setEditing(true)} />
        )}
      </div>
    </>
  );
}

function ConnectedMailbox({ profile, onEdit }: { profile: ProfileDetail; onEdit: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [disconnecting, setDisconnecting] = useState(false);
  const mailbox = profile.mailbox;
  const label = useProviderLabel(mailbox?.provider);

  const poll = useApiMutation(API_ROUTES.mailboxPoll, {
    invalidates: [API_ROUTES.profilesGet],
    onSuccess: () => toast.success("Queued", "Kick Rocks is checking the inbox now."),
  });
  const disconnect = useApiMutation(API_ROUTES.mailboxDelete, {
    invalidates: [API_ROUTES.profilesGet, API_ROUTES.profilesList, API_ROUTES.dashboardGet],
    onSuccess: () => {
      setDisconnecting(false);
      toast.success("Disconnected", "The mailbox was removed from this profile.");
      navigate(`/profiles/${profile.id}`);
    },
  });

  if (!mailbox) return null;

  const failed = Boolean(mailbox.lastError);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="break-all font-mono text-heading font-medium text-ink">
            {mailbox.address}
          </h2>
          <span className="mt-0.5 inline-flex items-center gap-2 text-meta text-ink-2">
            <StatusShapeGlyph shape={failed ? "triangle" : "disc"} />
            {failed ? "Last check failed" : "Connected"}
          </span>
        </div>
        <Button
          loading={poll.isPending}
          onClick={() => poll.mutate({ params: { id: profile.id } })}
        >
          Check inbox now
        </Button>
      </div>
      {mailbox.lastError ? (
        <Callout intent="warning" title="The last check failed" className="mb-3">
          {mailbox.lastError}
        </Callout>
      ) : null}
      <SendPauseAlert mailbox={mailbox} />
      {poll.error ? (
        <Callout intent="danger" className="mb-3">
          {errorMessage(poll.error)}
        </Callout>
      ) : null}
      <MailboxFacts mailbox={mailbox} providerLabel={label} hideAddress />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="danger" onClick={() => setDisconnecting(true)}>
          Disconnect
        </Button>
        <Button variant="primary" onClick={onEdit}>
          Edit connection
        </Button>
      </div>
      <ConfirmDialog
        open={disconnecting}
        onClose={() => {
          setDisconnecting(false);
          disconnect.reset();
        }}
        title="Disconnect this mailbox?"
        description="Requests that are queued will wait until a mailbox is connected again. Mail already sent stays in your account."
        confirmLabel="Disconnect"
        destructive
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate({ params: { id: profile.id } })}
      >
        {disconnect.error ? (
          <Callout intent="danger" className="mt-1">
            {errorMessage(disconnect.error)}
          </Callout>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

interface TestOutcome {
  signature: string;
  result: MailboxTestResult;
}

interface WizardProps {
  profile: ProfileDetail;
  providers: readonly ProviderPreset[];
  onCancel: (() => void) | undefined;
  onSaved: () => void;
}

function Wizard({ profile, providers, onCancel, onSaved }: WizardProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const existing = profile.mailbox;
  const [form, setForm] = useState<ConnectionForm>(() =>
    existing ? formFromMailbox(existing) : emptyForm(profile.primaryEmail ?? ""),
  );
  const [step, setStep] = useState<StepIndex>(existing ? 1 : 0);
  const [errors, setErrors] = useState<FormErrors>({});
  const [tested, setTested] = useState<TestOutcome | null>(null);
  const [refreshed, setRefreshed] = useState<readonly MailFolder[] | null>(null);

  const preset = providers.find((candidate) => candidate.id === form.providerId);
  const current = tested && tested.signature === connectionSignature(form) ? tested.result : null;
  const passed = Boolean(current?.smtp.ok && current.imap.ok);
  const folders = refreshed ?? current?.imap.folders ?? [];

  const test = useApiMutation(API_ROUTES.mailboxTest);
  const folderQuery = useApiQuery(API_ROUTES.mailboxFolders, {
    params: { id: profile.id },
    enabled: false,
  });
  const save = useApiMutation(API_ROUTES.mailboxSave, {
    invalidates: [API_ROUTES.profilesGet, API_ROUTES.profilesList, API_ROUTES.dashboardGet],
    onSuccess: (saved) => {
      onSaved();
      if (existing) {
        toast.success("Saved", `${saved.address} is connected.`);
        navigate(`/profiles/${profile.id}`);
        return;
      }
      toast.success("Saved", `${saved.address} is connected. Next, start a campaign.`);
      navigate("/");
    },
  });

  const change = (next: ConnectionForm) => {
    setForm(next);
    setErrors({});
  };

  const choosePreset = (chosen: ProviderPreset) => {
    change(applyPreset(form, chosen));
    setRefreshed(null);
  };

  const runTest = async () => {
    const signature = connectionSignature(form);
    try {
      const result = await test.mutateAsync({
        params: { id: profile.id },
        body: connectionBody(form),
      });
      setTested({ signature, result });
      setRefreshed(null);
    } catch {
      setTested(null);
    }
  };

  const refreshFolders = async () => {
    const result = await folderQuery.refetch();
    if (result.data) setRefreshed(result.data.folders);
  };

  const next = () => {
    if (step === 0) {
      if (!preset) {
        setErrors({ providerId: "Choose a provider to continue." });
        return;
      }
      setStep(1);
    } else if (step === 1) {
      const found = validateConnection(form, { passwordOptional: existing !== null });
      setErrors(found);
      if (Object.keys(found).length === 0) setStep(2);
    } else if (step === 2) {
      if (!existing && form.replyFolder === "INBOX") {
        setForm({ ...form, replyFolder: suggestedFolder(folders) });
      }
      setStep(3);
    }
  };

  const submit = () => {
    const found = validateSettings(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate({ params: { id: profile.id }, body: saveBody(form) });
  };

  const saveFailure = save.error;
  const explained = saveFailure instanceof ApiRequestError && saveFailure.issues.length > 0;
  const testFailure = test.error ? errorMessage(test.error) : null;

  return (
    <div>
      <Stepper step={step} />
      <div className="mt-5">
        {step === 0 ? (
          <Section label="Choose your provider">
            <ProviderStep
              providers={providers}
              form={form}
              onChoose={choosePreset}
              error={errors.providerId}
            />
          </Section>
        ) : null}
        {step === 1 && preset ? (
          <Section label="Sign in details">
            <AccountStep
              preset={preset}
              form={form}
              errors={errors}
              onChange={change}
              hasSavedPassword={existing !== null}
            />
          </Section>
        ) : null}
        {step === 2 && preset ? (
          <Section label="Test the connection">
            <TestStep
              form={form}
              preset={preset}
              result={current}
              testing={test.isPending}
              failure={testFailure}
              onTest={runTest}
            />
          </Section>
        ) : null}
        {step === 3 && preset ? (
          <Section label="Reply folder and daily limit">
            <SettingsStep
              form={form}
              preset={preset}
              errors={errors}
              folders={folders}
              onChange={change}
              onRefreshFolders={existing ? refreshFolders : undefined}
              refreshing={folderQuery.isFetching}
            />
            {saveFailure ? (
              <Callout intent="danger" title="Could not save the mailbox" className="mt-4">
                {explained
                  ? Object.values(saveFailure.fieldErrors).join(" ")
                  : errorMessage(saveFailure)}
              </Callout>
            ) : null}
          </Section>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div>
          {step === 0 && onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : step === 0 ? (
            <LinkButton to={`/profiles/${profile.id}`} variant="ghost">
              Cancel
            </LinkButton>
          ) : (
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setErrors({});
                setStep((step - 1) as StepIndex);
              }}
            >
              Back
            </Button>
          )}
        </div>
        {step === 3 ? (
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save mailbox
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={(step === 2 && !passed) || (step === 0 && !preset)}
            onClick={next}
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: StepIndex }) {
  return (
    <nav aria-label="Progress">
      <ol className="m-0 flex list-none items-center gap-2 p-0 text-meta sm:gap-3">
        {STEPS.map((label, index) => {
          const state = index < step ? "done" : index === step ? "current" : "todo";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2",
                state === "current" ? "font-medium text-ink" : "text-ink-3",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-xs border font-mono text-label",
                  state === "todo" && "border-line-strong",
                  state === "current" && "border-accent-fill bg-accent-fill text-accent-on",
                  state === "done" && "border-line-strong bg-active text-ink-2",
                )}
              >
                {index + 1}
              </span>
              <span className={cn(state !== "current" && "max-sm:sr-only")}>{label}</span>
              {index < STEPS.length - 1 ? (
                <span aria-hidden="true" className="hidden h-px w-6 bg-line-strong sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
