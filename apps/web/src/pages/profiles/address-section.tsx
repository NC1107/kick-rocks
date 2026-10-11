import { US_STATES } from "@kickrocks/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Callout,
  Checkbox,
  Field,
  IconButton,
  Input,
  RowGroup,
  Section,
  Select,
  Tag,
} from "../../components/ui/index.js";
import { GroupNote } from "../settings/rows.js";
import {
  addDraft,
  type DraftErrors,
  dayBefore,
  fieldKey,
  type IdentityDraft,
  isPastAddress,
  makePrimary,
  openEndedAddresses,
  recordMoveOut,
  removeDraft,
  rowErrors,
  scanAddressKey,
  tidyAddressDraft,
  unusableScanAddress,
  updateDraft,
  validateDrafts,
} from "./identity-drafts.js";

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthYear = (date: string) => MONTH_YEAR.format(new Date(`${date}T00:00:00Z`));

function streetLine(draft: IdentityDraft): string {
  return [draft.street.trim(), draft.unit.trim()].filter(Boolean).join(", ") || "New address";
}

function placeLine(draft: IdentityDraft): string {
  const region = [draft.state, draft.zip.trim()].filter(Boolean).join(" ");
  return [draft.city.trim(), region].filter(Boolean).join(", ");
}

function periodLine(draft: IdentityDraft): string {
  if (draft.validFrom && draft.validTo) {
    return `${monthYear(draft.validFrom)} - ${monthYear(draft.validTo)}`;
  }
  if (draft.validTo) return `Until ${monthYear(draft.validTo)}`;
  if (draft.validFrom) return `Since ${monthYear(draft.validFrom)}`;
  return "No dates";
}

interface AddressSectionProps {
  drafts: readonly IdentityDraft[];
  onChange: (drafts: IdentityDraft[]) => void;
  errors: DraftErrors;
  disabled?: boolean | undefined;
  today: string;
}

/**
 * Addresses take far more room than any other identity, so a saved one folds to a summary and
 * opens only when edited. Folding saves nothing: the card's single Save still replaces the list.
 */
export function AddressSection({ drafts, onChange, errors, disabled, today }: AddressSectionProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [checked, setChecked] = useState<Record<string, Record<string, string>>>({});
  const addressDrafts = drafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft }) => draft.kind === "address");
  const scanKey = scanAddressKey(drafts, today);
  const scanDraft = drafts.find((draft) => draft.key === scanKey);
  const unusable = unusableScanAddress(drafts, today);

  const setIn = (set: ReadonlySet<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const openRow = (key: string) => setOpen((current) => setIn(current, key, true));

  const add = () => {
    const next = addDraft(drafts, "address");
    const created = next.at(-1);
    onChange(next);
    if (!created) return;
    openRow(created.key);
    setFresh((current) => setIn(current, created.key, true));
  };

  const finish = (key: string, index: number) => {
    const tidied = drafts.map((draft) => (draft.key === key ? tidyAddressDraft(draft) : draft));
    const found = rowErrors(validateDrafts(tidied, today), index);
    onChange(tidied);
    setChecked((current) => ({ ...current, [key]: found }));
    if (Object.keys(found).length > 0) return;
    setOpen((current) => setIn(current, key, false));
    setFresh((current) => setIn(current, key, false));
  };

  return (
    <Section label="Addresses" count={addressDrafts.length} as="h3" className="min-w-0">
      {addressDrafts.length > 0 ? (
        <RowGroup>
          {addressDrafts.map(({ draft, index }, position) => {
            const rowChecked = checked[draft.key] ?? {};
            const hasError =
              Object.keys(rowChecked).length > 0 ||
              Object.keys(rowErrors(errors, index)).length > 0;
            const isOpen = open.has(draft.key) || hasError;
            const label = `Edit address ${position + 1}`;
            if (!isOpen) {
              return (
                <div key={draft.key} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui text-ink">{streetLine(draft)}</p>
                    <p className="truncate text-meta text-ink-2">{placeLine(draft)}</p>
                    <p className="mt-0.5 font-mono text-caption text-ink-3">{periodLine(draft)}</p>
                  </div>
                  {draft.key === scanKey ? <Tag>Used for scans</Tag> : null}
                  {isPastAddress(draft, today) ? <Tag>Past</Tag> : null}
                  <IconButton
                    label={label}
                    disabled={disabled}
                    className="pointer-coarse:size-11"
                    onClick={() => openRow(draft.key)}
                  >
                    <Pencil />
                  </IconButton>
                </div>
              );
            }
            return (
              <AddressRow
                key={draft.key}
                draft={draft}
                index={index}
                position={position}
                drafts={drafts}
                errors={errors}
                checked={rowChecked}
                isFresh={fresh.has(draft.key)}
                isScanAddress={draft.key === scanKey}
                disabled={disabled}
                today={today}
                onChange={onChange}
                onEdit={() => setChecked((current) => ({ ...current, [draft.key]: {} }))}
                onDone={() => finish(draft.key, index)}
              />
            );
          })}
        </RowGroup>
      ) : (
        <p className="text-meta text-ink-3">None added.</p>
      )}
      <Button className="mt-2 w-full" disabled={disabled} onClick={add}>
        <Plus aria-hidden="true" />
        {addressDrafts.length === 0 ? "Add address" : "Add another address"}
      </Button>
      {unusable ? (
        <Callout
          intent="warning"
          title="Marked for scans, but you moved out"
          className="mt-2"
          action={
            <Button size="sm" onClick={() => openRow(unusable.key)}>
              Fix
            </Button>
          }
        >
          {streetLine(unusable)} has a move-out date in the past, so scans will not use it.
        </Callout>
      ) : null}
      <GroupNote>
        {scanDraft
          ? `Scans and requests use ${[scanDraft.street.trim(), scanDraft.city.trim()].filter(Boolean).join(", ")}. `
          : "Scans and requests need a current address. "}
        Past addresses are searched only when a scan includes them.
      </GroupNote>
    </Section>
  );
}

interface AddressRowProps {
  draft: IdentityDraft;
  index: number;
  position: number;
  drafts: readonly IdentityDraft[];
  errors: DraftErrors;
  checked: Record<string, string>;
  isFresh: boolean;
  isScanAddress: boolean;
  disabled: boolean | undefined;
  today: string;
  onChange: (drafts: IdentityDraft[]) => void;
  onEdit: () => void;
  onDone: () => void;
}

function AddressRow({
  draft,
  index,
  position,
  drafts,
  errors,
  checked,
  isFresh,
  isScanAddress,
  disabled,
  today,
  onChange,
  onEdit,
  onDone,
}: AddressRowProps) {
  const ref = useRef<HTMLFieldSetElement>(null);
  const streetRef = useRef<HTMLInputElement>(null);
  const [livesHere, setLivesHere] = useState(true);
  const [movedOut, setMovedOut] = useState<string | null>(null);
  const hasError = Object.keys(checked).length > 0;
  const serverSide = Object.keys(rowErrors(errors, index)).length > 0;

  useEffect(() => {
    if (isFresh) streetRef.current?.focus();
  }, [isFresh]);
  useEffect(() => {
    if (hasError || serverSide) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [hasError, serverSide]);

  const error = (path: string) => checked[path] ?? errors.fields[fieldKey(index, path)];
  const change = (patch: Partial<IdentityDraft>) => {
    if (hasError) onEdit();
    onChange(updateDraft(drafts, draft.key, patch));
  };
  const tidy = () => onChange(drafts.map((d) => (d.key === draft.key ? tidyAddressDraft(d) : d)));
  const section = `section-address-${position + 1}`;

  const others = isFresh && livesHere ? openEndedAddresses(drafts, draft.key, today) : [];
  const previous = others[0];
  const moveOutDate = movedOut ?? dayBefore(draft.validFrom || today);

  return (
    <fieldset ref={ref} className="m-0 flex min-w-0 flex-col gap-3 border-0 bg-surface px-3.5 py-3">
      <legend className="sr-only">Address {position + 1}</legend>
      <div className="grid gap-3 lg:grid-cols-6">
        <Field
          label="Street"
          help="Just the street and number"
          error={error("value.street")}
          className="lg:col-span-4"
        >
          <Input
            ref={streetRef}
            name={`${section}-line1`}
            autoComplete={`${section} address-line1`}
            value={draft.street}
            disabled={disabled}
            onChange={(event) => change({ street: event.target.value })}
            onBlur={tidy}
          />
        </Field>
        <Field
          label="Apt, suite, unit"
          optional
          error={error("value.unit")}
          className="lg:col-span-2"
        >
          <Input
            name={`${section}-line2`}
            autoComplete={`${section} address-line2`}
            value={draft.unit}
            disabled={disabled}
            onChange={(event) => change({ unit: event.target.value })}
            onBlur={tidy}
          />
        </Field>
        <Field label="City" error={error("value.city")} className="lg:col-span-3">
          <Input
            name={`${section}-city`}
            autoComplete={`${section} address-level2`}
            value={draft.city}
            disabled={disabled}
            onChange={(event) => change({ city: event.target.value })}
          />
        </Field>
        <Field label="State" error={error("value.state")} className="lg:col-span-2">
          <Select
            name={`${section}-state`}
            autoComplete={`${section} address-level1`}
            value={draft.state}
            disabled={disabled}
            onChange={(event) => change({ state: event.target.value })}
          >
            <option value="">Choose</option>
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ZIP" error={error("value.zip")} className="lg:col-span-1">
          <Input
            name={`${section}-zip`}
            autoComplete={`${section} postal-code`}
            inputMode="numeric"
            value={draft.zip}
            disabled={disabled}
            onChange={(event) => change({ zip: event.target.value })}
          />
        </Field>
        <Field label="Lived here from" optional className="lg:col-span-3">
          <Input
            type="date"
            max={today}
            value={draft.validFrom}
            disabled={disabled}
            onChange={(event) => change({ validFrom: event.target.value })}
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
            onChange={(event) => change({ validTo: event.target.value })}
          />
        </Field>
      </div>
      {isFresh ? (
        <Checkbox
          label="I live here now"
          checked={livesHere}
          disabled={disabled}
          onChange={(event) => {
            setLivesHere(event.target.checked);
            if (event.target.checked) change({ validTo: "" });
          }}
        />
      ) : null}
      {previous ? (
        <div className="flex flex-col gap-2 rounded-sm border border-line px-3 py-2.5">
          <p className="text-ui text-ink">
            Did you move out of {previous.street.trim() || "your other address"}?
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Moved out on" className="min-w-40 flex-1">
              <Input
                type="date"
                value={moveOutDate}
                disabled={disabled}
                onChange={(event) => setMovedOut(event.target.value)}
              />
            </Field>
            <Button
              disabled={disabled || moveOutDate === ""}
              onClick={() => {
                onChange(recordMoveOut(drafts, previous.key, moveOutDate, draft.key));
                setMovedOut(null);
              }}
            >
              Yes, I moved out
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={disabled} onClick={onDone}>
          Done
        </Button>
        {!isScanAddress && !isPastAddress(draft, today) ? (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(makePrimary(drafts, draft.key))}
          >
            Use for scans and requests
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="ml-auto"
          aria-label={`Remove address ${position + 1}`}
          disabled={disabled}
          onClick={() => onChange(removeDraft(drafts, draft.key))}
        >
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      </div>
    </fieldset>
  );
}
