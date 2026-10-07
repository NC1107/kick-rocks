import { API_ROUTES, type ProfileSummary } from "@kickrocks/shared";
import { Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage, useApiMutation, useApiQuery, useCurrentProfile } from "../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  LinkButton,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableSkeletonRows,
  useToast,
} from "../../components/ui/index.js";
import { formatRelative } from "../../lib/format.js";

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
      <Plus aria-hidden="true" className="size-4" />
      New profile
    </LinkButton>
  );

  return (
    <>
      <PageHeader
        title="Profiles"
        description="The people Kick Rocks sends requests for. Each has its own mailbox."
        actions={profiles.length > 0 ? newProfile : undefined}
      />
      {query.error ? (
        <Alert
          intent="danger"
          title="Could not load profiles"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      ) : query.data && profiles.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No profiles yet"
          description="A profile holds one person's name, email, and address, and the mailbox requests are sent from."
          actions={newProfile}
        />
      ) : (
        <Table label="Profiles">
          <TableHead>
            <tr>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell>Email</TableHeaderCell>
              <TableHeaderCell>Mailbox</TableHeaderCell>
              <TableHeaderCell>Changed</TableHeaderCell>
              <TableHeaderCell align="right">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {query.isPending ? (
              <TableSkeletonRows columns={6} rows={3} />
            ) : (
              profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell wrap>
                    <div className="flex min-w-48 flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        to={`/profiles/${profile.id}`}
                        className="rounded-xs font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {profile.displayName}
                      </Link>
                      {profile.id === current?.id ? <Badge tone="blue">Current</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{profile.state}</TableCell>
                  <TableCell
                    className="max-w-56 truncate text-ink-muted"
                    title={profile.primaryEmail ?? undefined}
                  >
                    {profile.primaryEmail ?? "None"}
                  </TableCell>
                  <TableCell>
                    {profile.mailboxConnected ? (
                      <Badge tone="green">Connected</Badge>
                    ) : (
                      <Link
                        to={`/profiles/${profile.id}/mailbox`}
                        className="rounded-xs text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                      >
                        Connect
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {formatRelative(profile.updatedAt)}
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-1">
                      {profile.id === current?.id ? null : (
                        <Button size="sm" variant="ghost" onClick={() => setProfileId(profile.id)}>
                          Make current
                        </Button>
                      )}
                      <IconButton
                        label={`Delete ${profile.displayName}`}
                        size="sm"
                        onClick={() => setPending(profile)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
          <Alert intent="danger" className="mt-1">
            {errorMessage(remove.error)}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
