import { API_ROUTES, type ProfileSummary } from "@kickrocks/shared";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage, useApiMutation, useApiQuery, useCurrentProfile } from "../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  IconButton,
  LinkButton,
  PageHeader,
  RelativeTime,
  RowGroup,
  Section,
  Skeleton,
  StatusShapeGlyph,
  Tag,
  Tooltip,
  useToast,
} from "../../components/ui/index.js";

const ROW =
  "marked group relative flex min-h-row flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2 transition-colors duration-100 hover:bg-hover data-[selected=true]:bg-accent-soft";

function ProfileRow({
  profile,
  current,
  onMakeCurrent,
  onDelete,
}: {
  profile: ProfileSummary;
  current: boolean;
  onMakeCurrent: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      aria-label={profile.displayName}
      data-selected={current ? "true" : undefined}
      className={ROW}
    >
      <div className="flex min-w-0 flex-1 basis-56 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <Link
            to={`/profiles/${profile.id}`}
            className="min-w-0 truncate rounded-xs text-ui font-medium text-ink after:absolute after:inset-0 after:content-['']"
          >
            {profile.displayName}
          </Link>
          {current ? <Tag>Current</Tag> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-caption text-ink-3">
          <span>{profile.state}</span>
          <span aria-hidden="true">·</span>
          {profile.primaryEmail ? (
            <Tooltip content={profile.primaryEmail} className="min-w-0">
              <span className="min-w-0 truncate">{profile.primaryEmail}</span>
            </Tooltip>
          ) : (
            <span>no email</span>
          )}
        </span>
      </div>
      <div className="relative flex items-center text-meta">
        {profile.mailboxConnected ? (
          <span className="inline-flex items-center gap-2 text-ink-2">
            <StatusShapeGlyph shape="disc" />
            Mailbox connected
          </span>
        ) : (
          <Link
            to={`/profiles/${profile.id}/mailbox`}
            className="rounded-xs text-accent-text underline underline-offset-2 max-sm:flex max-sm:min-h-11 max-sm:items-center"
          >
            Connect mailbox
          </Link>
        )}
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-caption tabular-nums text-ink-3 max-sm:hidden">
        <RelativeTime iso={profile.updatedAt} />
      </span>
      <div className="relative flex items-center justify-end gap-1 opacity-0 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 max-sm:opacity-100 sm:w-36">
        {current ? null : (
          <Button size="sm" variant="ghost" onClick={onMakeCurrent}>
            Make current
          </Button>
        )}
        <IconButton label={`Delete ${profile.displayName}`} size="sm" onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

export function Component() {
  const query = useApiQuery(API_ROUTES.profilesList);
  const { profile: current, setProfileId } = useCurrentProfile();
  const toast = useToast();
  const [pending, setPending] = useState<ProfileSummary | null>(null);

  const remove = useApiMutation(API_ROUTES.profilesDelete, {
    invalidates: [API_ROUTES.profilesList],
    onSuccess: () => {
      toast.success("Deleted", `${pending?.displayName ?? "The profile"} was removed.`);
      setPending(null);
    },
  });

  const profiles = query.data?.profiles ?? [];
  const newProfile = (
    <LinkButton to="/profiles/new" variant="primary">
      New profile
    </LinkButton>
  );

  return (
    <>
      <PageHeader
        title="Profiles"
        description="Who requests are sent for"
        actions={profiles.length > 0 ? newProfile : undefined}
      />
      {query.error ? (
        <Callout
          intent="danger"
          title="Could not load profiles"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      ) : query.data && profiles.length === 0 ? (
        <EmptyState
          title="No profiles yet"
          description="A profile holds one person's name, email, and address, and the mailbox requests go out from."
          actions={newProfile}
        />
      ) : (
        <Section label="Profiles" {...(query.data ? { count: profiles.length } : {})}>
          {query.isPending ? (
            <RowGroup aria-busy="true">
              <span className="sr-only">Loading</span>
              {[0, 1, 2].map((key) => (
                <div key={key} className="flex min-h-row items-center px-3.5 py-2">
                  <Skeleton className="h-4 w-48" />
                </div>
              ))}
            </RowGroup>
          ) : (
            <RowGroup role="list" aria-label="Profiles" className="list-none">
              {profiles.map((profile) => (
                <ProfileRow
                  key={profile.id}
                  profile={profile}
                  current={profile.id === current?.id}
                  onMakeCurrent={() => setProfileId(profile.id)}
                  onDelete={() => setPending(profile)}
                />
              ))}
            </RowGroup>
          )}
        </Section>
      )}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
          remove.reset();
        }}
        title={`Delete ${pending?.displayName ?? "this profile"}?`}
        description="This also deletes its identities, mailbox connection, requests, and replies. It cannot be undone."
        confirmLabel="Delete profile"
        destructive
        loading={remove.isPending}
        onConfirm={() => pending && remove.mutate({ params: { id: pending.id } })}
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
