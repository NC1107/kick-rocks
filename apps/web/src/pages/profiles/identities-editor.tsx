import { type IdentityKind, US_STATES } from "@kickrocks/shared";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Select,
} from "../../components/ui/index.js";
import { IDENTITY_KIND_LABELS } from "../../lib/labels.js";
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
  description: string;
  addLabel: string;
  /** The most rows allowed. A person has one birth date. */
  max?: number;
}

const SECTIONS: readonly SectionSpec[] = [
  {
    kind: "name",
    title: "Names",
    description: "The name requests go out under. Mark one as primary.",
    addLabel: "Add name",
  },
  {
    kind: "alias",
    title: "Aliases",
    description: "Nicknames, maiden names, and spellings brokers may list you under.",
    addLabel: "Add alias",
  },
  {
    kind: "email",
    title: "Email addresses",
    description: "Brokers often know you by an old address. Add every one you have used.",
    addLabel: "Add email",
  },
  {
    kind: "phone",
    title: "Phone numbers",
    description: "Used only when a broker or form asks for one.",
    addLabel: "Add phone",
  },
  {
    kind: "address",
    title: "Addresses",
    description:
      "Current and past addresses. Dates tell Kick Rocks which one to use and which to search under.",
    addLabel: "Add address",
  },
  {
    kind: "dob",
    title: "Date of birth",
    description: "Disclosed only when a broker requires it and you approve it.",
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

export interface IdentitiesEditorProps {
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
    <div className="divide-y divide-line">
      {errors.general.length > 0 ? (
        <div className="pb-5">
          <Alert intent="danger" title="Some details need attention">
            {errors.general.join(" ")}
          </Alert>
        </div>
      ) : null}
      {SECTIONS.map((section) => {
        const rows = drafts
          .map((draft, index) => ({ draft, index }))
          .filter(({ draft }) => draft.kind === section.kind);
        const canAdd = section.max === undefined || rows.length < section.max;
        const error = errors.sections[section.kind];
        return (
          <section
            key={section.kind}
            aria-labelledby={`identities-${section.kind}`}
            className="py-5 first:pt-0 last:pb-0"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h3 id={`identities-${section.kind}`} className="text-base font-semibold text-ink">
                  {section.title}
                </h3>
                <p className="mt-0.5 max-w-xl text-sm text-ink-muted">{section.description}</p>
              </div>
              {canAdd ? (
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange(addDraft(drafts, section.kind))}
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  {section.addLabel}
                </Button>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="mb-3 text-sm text-danger-text">
                {error}
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-sm text-ink-faint">None added.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {rows.map(({ draft, index }, position) => (
                  <li key={draft.key}>
                    <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-md border border-line bg-canvas p-3 sm:flex-row sm:items-start sm:gap-4">
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
                      <div className="flex shrink-0 items-center gap-2 sm:mt-[1.625rem] sm:h-control sm:w-36 sm:justify-end">
                        {hasPrimary(draft.kind) ? (
                          draft.isPrimary ? (
                            <Badge tone="green">Primary</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={disabled}
                              onClick={() => onChange(makePrimary(drafts, draft.key))}
                            >
                              Make primary
                            </Button>
                          )
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
                    </fieldset>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
        <div className="grid gap-3 sm:grid-cols-3">
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
        <Field
          label="Phone number"
          error={error("value.number")}
          help="A US number can be typed as (555) 555-0123."
        >
          <Input
            type="tel"
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
        <div className="grid gap-3 sm:grid-cols-6">
          {text("Street", "street", "value.street", { className: "sm:col-span-4" })}
          {text("Unit", "unit", "value.unit", { optional: true, className: "sm:col-span-2" })}
          {text("City", "city", "value.city", { className: "sm:col-span-3" })}
          <Field label="State" error={error("value.state")} className="sm:col-span-2">
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
          {text("ZIP", "zip", "value.zip", { className: "sm:col-span-1" })}
          <Field label="Lived here from" optional className="sm:col-span-3">
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
            className="sm:col-span-3"
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
