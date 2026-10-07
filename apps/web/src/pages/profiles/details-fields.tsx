import { StateCode, US_STATES } from "@kickrocks/shared";
import { Field, Input, Select } from "../../components/ui/index.js";

export const DISPLAY_NAME_MAX = 80;

export interface DetailsValue {
  displayName: string;
  state: string;
}

export interface DetailsErrors {
  displayName?: string | undefined;
  state?: string | undefined;
}

/** What is wrong with the profile name and state, in words for the person. */
export function validateDetails(
  value: DetailsValue,
  { requireName }: { requireName: boolean },
): DetailsErrors {
  const errors: DetailsErrors = {};
  const name = value.displayName.trim();
  if (requireName && !name) errors.displayName = "Required";
  else if (name.length > DISPLAY_NAME_MAX) {
    errors.displayName = `Use ${DISPLAY_NAME_MAX} characters or fewer`;
  }
  if (!StateCode.safeParse(value.state).success) errors.state = "Choose a state";
  return errors;
}

export interface DetailsFieldsProps {
  value: DetailsValue;
  onChange: (value: DetailsValue) => void;
  errors: DetailsErrors;
  disabled?: boolean;
  namePlaceholder?: string;
}

/** The two fields on a profile itself, apart from its identities. */
export function DetailsFields({
  value,
  onChange,
  errors,
  disabled,
  namePlaceholder,
}: DetailsFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Profile name"
        error={errors.displayName}
        help="How this profile is listed. It defaults to the primary name."
      >
        <Input
          value={value.displayName}
          disabled={disabled}
          placeholder={namePlaceholder}
          onChange={(event) => onChange({ ...value, displayName: event.target.value })}
        />
      </Field>
      <Field
        label="State of residence"
        error={errors.state}
        help="Decides which state privacy law the requests cite."
      >
        <Select
          value={value.state}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, state: event.target.value })}
        >
          <option value="">Select a state</option>
          {US_STATES.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
