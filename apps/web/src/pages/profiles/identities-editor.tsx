import { type IdentityKind, US_STATES } from "@kickrocks/shared";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button,
  Callout,
  Field,
  IconButton,
  Input,
  RowGroup,
  Section,
  Select,
  Tag,
} from "../../components/ui/index.js";
import { IDENTITY_KIND_LABELS } from "../../lib/labels.js";
import { GroupNote } from "../settings/rows.js";
import {
  addDraft,
  type DraftErrors,
  fieldKey,
  hasPrimary,
  type IdentityDraft,
  makePrimary,
  normalizePhone,
  removeDraft,
  updateDraft,
} from "./identity-drafts.js";

interface SectionSpec {
  kind: IdentityKind;
  title: string;
  /** One line under the group, only where the rows do not say it. */
  note?: string;
  addLabel: string;
  /** The most rows allowed. A person has one birth date. */
  max?: number;
}

const SECTIONS: readonly SectionSpec[] = [
  {
    kind: "name",
    title: "Names",
    addLabel: "Add name",
  },
  {
    kind: "alias",
    title: "Aliases",
    addLabel: "Add alias",
  },
  {
    kind: "email",
    title: "Email addresses",
    note: "Add every address you have used. Targets often know an old one.",
    addLabel: "Add email",
  },
  {
    kind: "phone",
    title: "Phone numbers",
    note: "Used only when a target or form asks for one.",
    addLabel: "Add phone",
  },
  {
    kind: "address",
    title: "Addresses",
    note: "Dates tell Kick Rocks which address to use and which to search under.",
    addLabel: "Add address",
  },
  {
    kind: "dob",
    title: "Date of birth",
    note: "Disclosed only when a target requires it and you approve it.",
    addLabel: "Add date of birth",
    max: 1,
  },
];

const SINGULAR: Record<IdentityKind, string> = {
  name: "name",
  alias: "alias",
  email: "email",
  phone: "phone number",
  address: "address",
  dob: "date of birth",
};

interface IdentitiesEditorProps {
  drafts: readonly IdentityDraft[];
  onChange: (drafts: IdentityDraft[]) => void;
  errors: DraftErrors;
  disabled?: boolean;
  /** Today as YYYY-MM-DD, the latest a birth date can be. */
  today: string;
}

/**
 * Every identity of one person, grouped by kind. Each kind with rows has exactly one primary, and
 * the editor keeps it that way, so the API's one-primary rule can only fail on the server for
 * reasons the page could not see.
 */
export function IdentitiesEditor({
  drafts,
  onChange,
  errors,
  disabled,
  today,
}: IdentitiesEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      {errors.general.length > 0 ? (
        <Callout intent="danger" title="Some details need attention">
          {errors.general.join(" ")}
        </Callout>
      ) : null}
      {SECTIONS.map((section) => {
        const rows = drafts
          .map((draft, index) => ({ draft, index }))
          .filter(({ draft }) => draft.kind === section.kind);
        const canAdd = section.max === undefined || rows.length < section.max;
        const error = errors.sections[section.kind];
        return (
          <Section
            key={section.kind}
            label={section.title}
            count={rows.length}
            as="h3"
            actions={
              canAdd ? (
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange(addDraft(drafts, section.kind))}
                >
                  {section.addLabel}
                </Button>
              ) : null
            }
          >
            {error ? (
              <p role="alert" className="mb-1.5 text-caption text-danger-text">
                {error}
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-meta text-ink-3">None added.</p>
            ) : (
              <RowGroup>
                {rows.map(({ draft, index }, position) => (
                  <fieldset
                    key={draft.key}
                    className="group m-0 flex min-w-0 flex-col gap-3 border-0 px-3.5 py-3 lg:flex-row lg:items-start lg:gap-4"
                  >
                    <legend className="sr-only">
                      {IDENTITY_KIND_LABELS[draft.kind]} {position + 1}
                    </legend>
                    <div className="min-w-0 flex-1">
                      <RowFields
                        draft={draft}
                        index={index}
                        errors={errors}
                        disabled={disabled}
                        today={today}
                        onChange={(change) => onChange(updateDraft(drafts, draft.key, change))}
                      />
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-1 lg:mt-[1.375rem] lg:h-control lg:w-44">
                      {hasPrimary(draft.kind) && draft.isPrimary ? <Tag>Primary</Tag> : null}
                      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 max-lg:opacity-100">
                        {hasPrimary(draft.kind) && !draft.isPrimary ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => onChange(makePrimary(drafts, draft.key))}
                          >
                            Make primary
                          </Button>
                        ) : null}
                        <IconButton
                          label={`Remove ${SINGULAR[draft.kind]} ${position + 1}`}
                          size="sm"
                          disabled={disabled}
                          onClick={() => onChange(removeDraft(drafts, draft.key))}
                        >
                          <Trash2 />
                        </IconButton>
                      </div>
                    </div>
                  </fieldset>
                ))}
              </RowGroup>
            )}
            {section.note ? <GroupNote>{section.note}</GroupNote> : null}
          </Section>
        );
      })}
    </div>
  );
}

interface RowFieldsProps {
  draft: IdentityDraft;
  index: number;
  errors: DraftErrors;
  disabled: boolean | undefined;
  today: string;
  onChange: (change: Partial<IdentityDraft>) => void;
}

function RowFields({ draft, index, errors, disabled, today, onChange }: RowFieldsProps) {
  const error = (path: string) => errors.fields[fieldKey(index, path)];
  const text = (
    label: string,
    key: keyof IdentityDraft & string,
    path: string,
    extra: { optional?: boolean; help?: ReactNode; className?: string } = {},
  ) => (
    <Field
      label={label}
      error={error(path)}
      {...(extra.optional ? { optional: true } : {})}
      {...(extra.help ? { help: extra.help } : {})}
      {...(extra.className ? { className: extra.className } : {})}
    >
      <Input
        value={draft[key] as string}
        disabled={disabled}
        onChange={(event) => onChange({ [key]: event.target.value })}
      />
    </Field>
  );

  switch (draft.kind) {
    case "name":
    case "alias":
      return (
        <div className="grid gap-3 lg:grid-cols-3">
          {text("First name", "first", "value.first")}
          {text("Middle name", "middle", "value.middle", { optional: true })}
          {text("Last name", "last", "value.last")}
        </div>
      );
    case "email":
      return (
        <Field label="Email address" error={error("value.address")}>
          <Input
            type="email"
            mono
            inputMode="email"
            autoComplete="off"
            value={draft.address}
            disabled={disabled}
            onChange={(event) => onChange({ address: event.target.value })}
          />
        </Field>
      );
    case "phone":
      return (
        <Field label="Phone number" error={error("value.number")} help="For example (555) 555-0123">
          <Input
            type="tel"
            mono
            inputMode="tel"
            autoComplete="off"
            value={draft.number}
            disabled={disabled}
            onChange={(event) => onChange({ number: event.target.value })}
            onBlur={() => onChange({ number: normalizePhone(draft.number) })}
          />
        </Field>
      );
    case "address":
      return (
        <div className="grid gap-3 lg:grid-cols-6">
          {text("Street", "street", "value.street", { className: "lg:col-span-4" })}
          {text("Unit", "unit", "value.unit", { optional: true, className: "lg:col-span-2" })}
          {text("City", "city", "value.city", { className: "lg:col-span-3" })}
          <Field label="State" error={error("value.state")} className="lg:col-span-2">
            <Select
              value={draft.state}
              disabled={disabled}
              onChange={(event) => onChange({ state: event.target.value })}
            >
              <option value="">Choose</option>
              {US_STATES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.name}
                </option>
              ))}
            </Select>
          </Field>
          {text("ZIP", "zip", "value.zip", { className: "lg:col-span-1" })}
          <Field label="Lived here from" optional className="lg:col-span-3">
            <Input
              type="date"
              max={today}
              value={draft.validFrom}
              disabled={disabled}
              onChange={(event) => onChange({ validFrom: event.target.value })}
            />
          </Field>
          <Field
            label="Until"
            optional
            error={error("validTo")}
            help="Leave empty for a current address."
            className="lg:col-span-3"
          >
            <Input
              type="date"
              value={draft.validTo}
              min={draft.validFrom || undefined}
              disabled={disabled}
              onChange={(event) => onChange({ validTo: event.target.value })}
            />
          </Field>
        </div>
      );
    case "dob":
      return (
        <div className="max-w-60">
          <Field label="Date of birth" error={error("value.date")}>
            <Input
              type="date"
              min="1900-01-01"
              max={today}
              value={draft.date}
              disabled={disabled}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          </Field>
        </div>
      );
  }
}
