import { API_ROUTES, type ProfileSummary } from "@kickrocks/shared";
import { MailCheck, MailPlus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery, useCurrentProfile } from "../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  EntityRow,
  IconAction,
  IconButton,
  LinkButton,
  PageHeader,
  RelativeTime,
  RowGroup,
  Section,
  Skeleton,
  Tag,
  useToast,
} from "../../components/ui/index.js";

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
    <li aria-label={profile.displayName} className="relative">
      <EntityRow
        to={{ kind: "profile", id: profile.id, name: profile.displayName }}
        title={profile.displayName}
        selected={current}
        meta={
          <span className="inline-flex min-w-0 max-w-full gap-1.5 font-mono text-caption">
            <span>{profile.state}</span>
            <span aria-hidden="true">{"\u00b7"}</span>
            <span className="truncate">{profile.primaryEmail ?? "no email"}</span>
          </span>
        }
        trailing={
          <>
            {current ? <Tag>Current</Tag> : null}
            <span className="w-14 shrink-0 text-right font-mono text-caption tabular-nums text-ink-3 max-sm:hidden">
              <RelativeTime iso={profile.updatedAt} />
            </span>
            <IconAction
              variant="ghost"
              icon={profile.mailboxConnected ? MailCheck : MailPlus}
              label={profile.mailboxConnected ? "Mailbox connected" : "Connect mailbox"}
              to={{ kind: "mailbox", profileId: profile.id, address: profile.primaryEmail ?? "" }}
            />
            {current ? null : (
              <IconAction
                variant="ghost"
                icon={Star}
                label="Make current"
                onClick={onMakeCurrent}
              />
            )}
            <IconButton label={`Delete ${profile.displayName}`} onClick={onDelete}>
              <Trash2 />
            </IconButton>
          </>
        }
      />
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
        hideDescriptionOnPhone
        actions={query.data && profiles.length === 0 ? undefined : newProfile}
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
