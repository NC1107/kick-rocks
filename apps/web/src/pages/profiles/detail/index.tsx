import { API_ROUTES, type ProfileDetail, type StateCode } from "@kickrocks/shared";
import { UserX } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiRequestError, errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
  useToast,
} from "../../../components/ui/index.js";
import { formatDate, formatRelative } from "../../../lib/format.js";
import { MailboxCard } from "../../mailbox/mailbox-card.js";
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
import { useUnsavedWarning } from "../use-unsaved-warning.js";

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
            icon={UserX}
            title="That profile does not exist"
            description="It may have been deleted. Pick another one from the list."
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
        <Alert
          intent="danger"
          title="Could not load this profile"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      </>
    );
  }

  return <ProfileEditor profile={query.data} />;
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="flex max-w-4xl flex-col gap-6">
      <div>
        <Skeleton className="mb-2 h-4 w-20" />
        <Skeleton className="h-7 w-64" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}

function ProfileEditor({ profile }: { profile: ProfileDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const remove = useApiMutation(API_ROUTES.profilesDelete, {
    invalidates: [API_ROUTES.profilesList],
    onSuccess: () => {
      toast.success("Deleted", `${profile.displayName} and its requests were removed.`);
      navigate("/profiles");
    },
  });

  return (
    <>
      <PageHeader
        title={profile.displayName}
        description={`Added ${formatDate(profile.createdAt)}. Last changed ${formatRelative(profile.updatedAt)}.`}
        back={{ to: "/profiles", label: "Profiles" }}
      />
      <div className="flex max-w-4xl flex-col gap-6">
        <DetailsCard profile={profile} />
        <IdentitiesCard profile={profile} />
        <MailboxCard profile={profile} />
        <Card>
          <CardHeader
            title="Delete this profile"
            description="Removes the profile, its identities, mailbox connection, and every request and reply recorded for it. Requests already sent cannot be recalled."
          />
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete profile
          </Button>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete ${profile.displayName}?`}
        description="This also deletes its requests and replies. It cannot be undone."
        confirmLabel="Delete profile"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate({ params: { id: profile.id } })}
      >
        {remove.error ? (
          <Alert intent="danger" className="mt-1">
            {errorMessage(remove.error)}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function DetailsCard({ profile }: { profile: ProfileDetail }) {
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
  useUnsavedWarning(dirty);

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
    <Card>
      <CardHeader title="Profile" />
      <form onSubmit={submit} noValidate>
        <DetailsFields
          value={value}
          onChange={setValue}
          errors={errors}
          disabled={update.isPending}
        />
        {failure && !explained ? (
          <Alert intent="danger" className="mt-4">
            {errorMessage(failure)}
          </Alert>
        ) : null}
        <CardFooter>
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
        </CardFooter>
      </form>
    </Card>
  );
}

function IdentitiesCard({ profile }: { profile: ProfileDetail }) {
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
  useUnsavedWarning(dirty);

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
    <Card>
      <CardHeader
        title="Identities"
        description="Everything a broker might have on file. Each request still sends only what that broker needs."
      />
      <form onSubmit={save} noValidate>
        <IdentitiesEditor
          drafts={drafts}
          onChange={setDrafts}
          errors={errors}
          disabled={replace.isPending}
          today={today}
        />
        {failure ? (
          <Alert intent="danger" title="Could not save identities" className="mt-5">
            {explained ? "Fix the marked fields and try again." : errorMessage(failure)}
          </Alert>
        ) : null}
        <CardFooter>
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
        </CardFooter>
      </form>
    </Card>
  );
}
