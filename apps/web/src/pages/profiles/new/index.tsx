import { API_ROUTES, type StateCode } from "@kickrocks/shared";
import { type FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ApiRequestError,
  errorMessage,
  useApiMutation,
  useCurrentProfile,
} from "../../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  LinkButton,
  PageHeader,
  useToast,
} from "../../../components/ui/index.js";
import { type DetailsErrors, DetailsFields, validateDetails } from "../details-fields.js";
import { IdentitiesEditor } from "../identities-editor.js";
import {
  type DraftErrors,
  defaultDisplayName,
  hasErrors,
  type IdentityDraft,
  localToday,
  NO_ERRORS,
  serverErrors,
  startingDrafts,
  toInputs,
  validateDrafts,
} from "../identity-drafts.js";
import { useUnsavedWarning } from "../use-unsaved-warning.js";

export function Component() {
  const navigate = useNavigate();
  const toast = useToast();
  const { setProfileId } = useCurrentProfile();
  const today = useMemo(() => localToday(), []);
  const [details, setDetails] = useState({ displayName: "", state: "" });
  const [drafts, setDrafts] = useState<IdentityDraft[]>(startingDrafts);
  const [detailErrors, setDetailErrors] = useState<DetailsErrors>({});
  const [draftErrors, setDraftErrors] = useState<DraftErrors>(NO_ERRORS);
  const [created, setCreated] = useState(false);

  const create = useApiMutation(API_ROUTES.profilesCreate, {
    invalidates: [API_ROUTES.profilesList],
    onSuccess: (profile) => {
      setCreated(true);
      setProfileId(profile.id);
      toast.success("Created", `${profile.displayName} is ready. Connect a mailbox next.`);
      navigate(`/profiles/${profile.id}/mailbox`);
    },
    onError: (error) => {
      setDraftErrors(serverErrors(error.fieldErrors));
      setDetailErrors({
        displayName: error.fieldErrors.displayName,
        state: error.fieldErrors.state,
      });
    },
  });

  const dirty =
    !created &&
    (details.displayName !== "" ||
      details.state !== "" ||
      drafts.some((draft) => draft.first || draft.last || draft.address || draft.street));
  useUnsavedWarning(dirty);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const displayName = details.displayName.trim() || defaultDisplayName(drafts);
    const nextDetails = validateDetails({ ...details, displayName }, { requireName: true });
    const nextDrafts = validateDrafts(drafts, today);
    setDetailErrors(nextDetails);
    setDraftErrors(nextDrafts);
    if (Object.keys(nextDetails).length > 0 || hasErrors(nextDrafts)) return;
    create.mutate({
      body: { displayName, state: details.state as StateCode, identities: toInputs(drafts) },
    });
  };

  const failure = create.error;
  const explained = failure instanceof ApiRequestError && failure.issues.length > 0;

  return (
    <>
      <PageHeader
        title="New profile"
        description="Add a person and the details brokers know them by."
        back={{ to: "/profiles", label: "Profiles" }}
      />
      <form onSubmit={submit} noValidate className="flex max-w-4xl flex-col gap-6">
        <Card>
          <CardHeader title="Profile" />
          <DetailsFields
            value={details}
            onChange={setDetails}
            errors={detailErrors}
            disabled={create.isPending}
            namePlaceholder={defaultDisplayName(drafts)}
          />
        </Card>
        <Card>
          <CardHeader
            title="Identities"
            description="Everything a broker might have on file. Each request still sends only what that broker needs."
          />
          <IdentitiesEditor
            drafts={drafts}
            onChange={setDrafts}
            errors={draftErrors}
            disabled={create.isPending}
            today={today}
          />
        </Card>
        {failure ? (
          <Alert intent="danger" title="Could not create the profile">
            {explained ? "Fix the marked fields and try again." : errorMessage(failure)}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <LinkButton to="/profiles" variant="ghost">
            Cancel
          </LinkButton>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create profile
          </Button>
        </div>
      </form>
    </>
  );
}
