import { API_ROUTES, type ProfileDetail, type StateCode } from "@kickrocks/shared";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiRequestError, errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  PageHeader,
  RowGroup,
  Section,
  Skeleton,
  useToast,
} from "../../../components/ui/index.js";
import { formatDate, formatRelative } from "../../../lib/format.js";
import { MailboxCard } from "../../mailbox/mailbox-card.js";
import { ActionRow, GroupFooter, GroupNote } from "../../settings/rows.js";
import { type DetailsErrors, DetailsFields, validateDetails } from "../details-fields.js";
import { IdentitiesEditor } from "../identities-editor.js";
import {
  type DraftErrors,
  hasErrors,
  type IdentityDraft,
  localToday,
  NO_ERRORS,
  serverErrors,
  snapshot,
  toDrafts,
  toInputs,
  validateDrafts,
} from "../identity-drafts.js";
import { UnsavedChangesDialog, useUnsavedWarning } from "../use-unsaved-warning.js";
import { DataCard } from "./DataCard.js";

const SAVED_ROUTES = [API_ROUTES.profilesList, API_ROUTES.profilesGet] as const;

export function Component() {
  const { id = "" } = useParams();
  const query = useApiQuery(API_ROUTES.profilesGet, { params: { id } });

  if (query.isPending) return <DetailSkeleton />;

  if (query.error) {
    if (query.error instanceof ApiRequestError && query.error.status === 404) {
      return (
        <>
          <PageHeader title="Profile" back={{ to: "/profiles", label: "Profiles" }} />
          <EmptyState
            title="That profile does not exist"
            description="It may have been deleted."
            actions={
              <LinkButton to="/profiles" variant="primary">
                Back to profiles
              </LinkButton>
            }
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title="Profile" back={{ to: "/profiles", label: "Profiles" }} />
        <Callout
          intent="danger"
          title="Could not load this profile"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      </>
    );
  }

  return <ProfileEditor profile={query.data} />;
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="flex max-w-3xl flex-col gap-4">
      <div>
        <Skeleton className="mb-2 h-4 w-20" />
        <Skeleton className="h-7 w-64" />
      </div>
      <Skeleton className="h-28 w-full rounded-md" />
      <Skeleton className="h-80 w-full rounded-md" />
    </div>
  );
}

function ProfileEditor({ profile }: { profile: ProfileDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dirtyParts, setDirtyParts] = useState({ details: false, identities: false });
  const unsaved = useUnsavedWarning(dirtyParts.details || dirtyParts.identities);
  const markDirty = (part: "details" | "identities") => (dirty: boolean) =>
    setDirtyParts((current) => (current[part] === dirty ? current : { ...current, [part]: dirty }));

  const remove = useApiMutation(API_ROUTES.profilesDelete, {
    invalidates: [API_ROUTES.profilesList],
    onSuccess: () => {
      unsaved.allowLeaving();
      toast.success("Deleted", `${profile.displayName} and its requests were removed.`);
      navigate("/profiles");
    },
  });

  return (
    <>
      <PageHeader
        title={profile.displayName}
        description={`Added ${formatDate(profile.createdAt)}, changed ${formatRelative(profile.updatedAt)}`}
        back={{ to: "/profiles", label: "Profiles" }}
      />
      <div className="flex max-w-3xl flex-col gap-4">
        <DetailsCard profile={profile} onDirtyChange={markDirty("details")} />
        <IdentitiesCard profile={profile} onDirtyChange={markDirty("identities")} />
        <MailboxCard profile={profile} />
        <DataCard profile={profile} />
        <Section label="Danger zone">
          <RowGroup>
            <ActionRow
              title="Delete this profile"
              description="Removes its identities, mailbox, requests, and replies. Requests already sent cannot be recalled."
            >
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete profile
              </Button>
            </ActionRow>
          </RowGroup>
        </Section>
      </div>
      <UnsavedChangesDialog blocker={unsaved.blocker} />
      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete ${profile.displayName}?`}
        description="This stops its running tasks and deletes its requests, replies, scans, and screenshots. It cannot be undone."
        confirmLabel="Delete profile"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate({ params: { id: profile.id } })}
      >
        {remove.error ? (
          <Callout intent="danger" className="mt-1">
            {errorMessage(remove.error)}
          </Callout>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function DetailsCard({
  profile,
  onDirtyChange,
}: {
  profile: ProfileDetail;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const [saved, setSaved] = useState({ displayName: profile.displayName, state: profile.state });
  const [value, setValue] = useState<{ displayName: string; state: string }>(saved);
  const [errors, setErrors] = useState<DetailsErrors>({});

  const update = useApiMutation(API_ROUTES.profilesUpdate, {
    invalidates: SAVED_ROUTES,
    onSuccess: (updated) => {
      const next = { displayName: updated.displayName, state: updated.state };
      setSaved(next);
      setValue(next);
      toast.success("Saved", "Profile details updated.");
    },
    onError: (error) =>
      setErrors({ displayName: error.fieldErrors.displayName, state: error.fieldErrors.state }),
  });

  const dirty = value.displayName !== saved.displayName || value.state !== saved.state;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = validateDetails(value, { requireName: true });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    update.mutate({
      params: { id: profile.id },
      body: { displayName: value.displayName.trim(), state: value.state as StateCode },
    });
  };

  const failure = update.error;
  const explained = failure instanceof ApiRequestError && failure.issues.length > 0;

  return (
    <form onSubmit={submit} noValidate>
      <Section label="Profile">
        <RowGroup>
          <DetailsFields
            value={value}
            onChange={setValue}
            errors={errors}
            disabled={update.isPending}
          />
          <GroupFooter>
            <Button
              variant="ghost"
              disabled={!dirty || update.isPending}
              onClick={() => {
                setValue(saved);
                setErrors({});
              }}
            >
              Discard changes
            </Button>
            <Button type="submit" variant="primary" disabled={!dirty} loading={update.isPending}>
              Save profile
            </Button>
          </GroupFooter>
        </RowGroup>
        {failure && !explained ? (
          <Callout intent="danger" className="mt-3">
            {errorMessage(failure)}
          </Callout>
        ) : null}
      </Section>
    </form>
  );
}

function IdentitiesCard({
  profile,
  onDirtyChange,
}: {
  profile: ProfileDetail;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const today = useMemo(() => localToday(), []);
  const [baseline, setBaseline] = useState<IdentityDraft[]>(() => toDrafts(profile.identities));
  const [drafts, setDrafts] = useState<IdentityDraft[]>(baseline);
  const [errors, setErrors] = useState<DraftErrors>(NO_ERRORS);

  const replace = useApiMutation(API_ROUTES.profilesReplaceIdentities, {
    invalidates: SAVED_ROUTES,
    onSuccess: (updated) => {
      const next = toDrafts(updated.identities);
      setBaseline(next);
      setDrafts(next);
      setErrors(NO_ERRORS);
      toast.success("Saved", "Identities updated.");
    },
    onError: (error) => setErrors(serverErrors(error.fieldErrors)),
  });

  const dirty = snapshot(drafts) !== snapshot(baseline);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const next = validateDrafts(drafts, today);
    setErrors(next);
    if (hasErrors(next)) return;
    replace.mutate({ params: { id: profile.id }, body: { identities: toInputs(drafts) } });
  };

  const failure = replace.error;
  const explained = failure instanceof ApiRequestError && failure.issues.length > 0;

  return (
    <form onSubmit={save} noValidate>
      <Section label="Identities" as="h2">
        <GroupNote className="mt-0 mb-2">
          Everything a broker might have on file. Each request sends only what that target needs.
        </GroupNote>
        <IdentitiesEditor
          drafts={drafts}
          onChange={setDrafts}
          errors={errors}
          disabled={replace.isPending}
          today={today}
        />
        {failure ? (
          <Callout intent="danger" title="Could not save identities" className="mt-4">
            {explained ? "Fix the marked fields and try again." : errorMessage(failure)}
          </Callout>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            disabled={!dirty || replace.isPending}
            onClick={() => {
              setDrafts(baseline);
              setErrors(NO_ERRORS);
              replace.reset();
            }}
          >
            Discard changes
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={replace.isPending}>
            Save identities
          </Button>
        </div>
      </Section>
    </form>
  );
}
