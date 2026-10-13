import { API_ROUTES, type ProfileSummary } from "@kickrocks/shared";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  errorMessage,
  useApiMutation,
  useApiQuery,
  useCurrentProfile,
} from "../../../api/index.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  EntityRow,
  IconButton,
  LinkButton,
  Menu,
  type MenuItem,
  RelativeTime,
  RowGroup,
  Section,
  Skeleton,
  useToast,
} from "../../../components/ui/index.js";
import { paths } from "../../../lib/paths.js";
import { SETTINGS_WIDTH } from "../rows.js";
import { SettingsHeader } from "../SettingsHeader.js";

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
  const navigate = useNavigate();
  const actions: MenuItem[] = [
    {
      id: "mailbox",
      label: profile.mailboxConnected ? "Open mailbox" : "Connect mailbox",
      onSelect: () => navigate(paths.mailbox(profile.id)),
    },
    ...(current ? [] : [{ id: "current", label: "Make current", onSelect: onMakeCurrent }]),
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      separatorBefore: true,
      onSelect: onDelete,
    },
  ];
  return (
    <li aria-label={profile.displayName} className="relative">
      <EntityRow
        to={{ kind: "profile", id: profile.id, name: profile.displayName }}
        title={
          <>
            {profile.displayName}
            {current ? (
              <span className="ml-2 font-mono text-caption font-normal text-ink-3">current</span>
            ) : null}
          </>
        }
        meta={
          <span className="inline-flex min-w-0 max-w-full gap-1.5 font-mono text-caption">
            <span>{profile.state}</span>
            <span aria-hidden="true">{"\u00b7"}</span>
            <span className="truncate">{profile.primaryEmail ?? "no email"}</span>
          </span>
        }
        trailing={
          <>
            <span className="w-14 shrink-0 text-right font-mono text-caption tabular-nums text-ink-3 max-sm:hidden">
              <RelativeTime iso={profile.updatedAt} />
            </span>
            <Menu
              align="end"
              items={actions}
              trigger={(props) => (
                <IconButton label="More" {...props}>
                  <MoreHorizontal />
                </IconButton>
              )}
            />
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
      <SettingsHeader
        section="Profiles"
        description="Who requests are sent for"
        hideDescriptionOnPhone
        actions={query.data && profiles.length === 0 ? undefined : newProfile}
      />
      <div className={SETTINGS_WIDTH}>
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
            description="A profile is one person's details and mailbox."
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
      </div>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
          remove.reset();
        }}
        title="Delete profile?"
        description={
          <>
            Deletes{" "}
            <span data-user-content="" className="font-medium text-ink">
              {pending?.displayName}
            </span>
            {"'s identities, mailbox connection, requests and replies for good."}
          </>
        }
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
