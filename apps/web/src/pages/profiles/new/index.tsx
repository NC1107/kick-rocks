import { API_ROUTES, type StateCode } from "@kickrocks/shared";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ApiRequestError,
  errorMessage,
  useApiMutation,
  useCurrentProfile,
} from "../../../api/index.js";
import {
  Button,
  Callout,
  LinkButton,
  PageHeader,
  RowGroup,
  Section,
  useToast,
} from "../../../components/ui/index.js";
import { GroupNote } from "../../settings/rows.js";
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
import { UnsavedChangesDialog, useUnsavedWarning } from "../use-unsaved-warning.js";

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
  const [attempts, setAttempts] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  const create = useApiMutation(API_ROUTES.profilesCreate, {
    invalidates: [API_ROUTES.profilesList],
    onSuccess: (profile) => {
      setCreated(true);
      unsaved.allowLeaving();
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
  const unsaved = useUnsavedWarning(dirty);

  // Once a submit has shown problems, each one clears as soon as the edit fixes it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an edit after a failed submit revalidates
  useEffect(() => {
    if (attempts === 0) return;
    const displayName = details.displayName.trim() || defaultDisplayName(drafts);
    setDetailErrors(validateDetails({ ...details, displayName }, { requireName: false }));
    setDraftErrors(validateDrafts(drafts, today));
  }, [details, drafts]);

  useEffect(() => {
    if (attempts === 0) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const displayName = details.displayName.trim() || defaultDisplayName(drafts);
    const nextDetails = validateDetails({ ...details, displayName }, { requireName: false });
    const nextDrafts = validateDrafts(drafts, today);
    setDetailErrors(nextDetails);
    setDraftErrors(nextDrafts);
    if (Object.keys(nextDetails).length > 0 || hasErrors(nextDrafts)) {
      setAttempts((count) => count + 1);
      return;
    }
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
        description="A person and the details brokers know them by"
        back={{ to: "/profiles", label: "Profiles" }}
      />
      <UnsavedChangesDialog blocker={unsaved.blocker} />
      <form ref={form} onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-4">
        <Section label="Profile">
          <RowGroup>
            <DetailsFields
              value={details}
              onChange={setDetails}
              errors={detailErrors}
              disabled={create.isPending}
              namePlaceholder={defaultDisplayName(drafts)}
            />
          </RowGroup>
        </Section>
        <Section label="Identities" as="h2">
          <GroupNote className="mt-0 mb-2">
            Everything a target might have on file. Each request sends only what that target needs.
          </GroupNote>
          <IdentitiesEditor
            drafts={drafts}
            onChange={setDrafts}
            errors={draftErrors}
            disabled={create.isPending}
            today={today}
          />
        </Section>
        {failure ? (
          <Callout intent="danger" title="Could not create the profile">
            {explained ? "Fix the marked fields and try again." : errorMessage(failure)}
          </Callout>
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
