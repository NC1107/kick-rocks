import { Download, Plus, Search, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  Input,
  LinkButton,
  RadioGroup,
  Select,
  Textarea,
} from "../../../components/ui/index.js";
import { Section, Specimen } from "./parts.js";

export function Controls() {
  const [right, setRight] = useState<"opt_out" | "delete" | "both">("both");
  const [checked, setChecked] = useState(true);
  const [rows, setRows] = useState([true, false, false]);
  const all = rows.every(Boolean);
  const some = rows.some(Boolean);

  return (
    <>
      <Section
        title="Buttons"
        description="Primary once per view. Secondary is the default. Danger only where the result cannot be undone."
      >
        <Specimen label="Variants">
          <Button variant="primary">
            <Send aria-hidden="true" className="size-4" />
            Send requests
          </Button>
          <Button>Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">
            <Trash2 aria-hidden="true" className="size-4" />
            Delete profile
          </Button>
        </Specimen>
        <Specimen label="States: loading, disabled">
          <Button variant="primary" loading>
            Sending
          </Button>
          <Button loading>Saving</Button>
          <Button variant="primary" disabled>
            Send requests
          </Button>
          <Button disabled>Cancel</Button>
          <Button variant="danger" disabled>
            Delete profile
          </Button>
        </Specimen>
        <Specimen label="Small, icon buttons, link button">
          <Button size="sm" variant="primary">
            <Plus aria-hidden="true" className="size-3.5" />
            Add
          </Button>
          <Button size="sm">Details</Button>
          <IconButton label="Download report" variant="secondary">
            <Download />
          </IconButton>
          <IconButton label="Delete" size="sm">
            <Trash2 />
          </IconButton>
          <IconButton label="Working" loading variant="secondary">
            <Download />
          </IconButton>
          <LinkButton to="/targets">Browse targets</LinkButton>
        </Specimen>
      </Section>

      <Section
        title="Form controls"
        description="Each control takes its id, help, and error from the Field around it."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Full name" help="As it appears on mail and in public records.">
            <Input defaultValue="Jordan Example" />
          </Field>
          <Field label="Email" error="Enter an address such as name@example.com.">
            <Input type="email" defaultValue="jordan@" />
          </Field>
          <Field label="Search targets" hideLabel className="md:col-span-2">
            <Input leading={<Search aria-hidden="true" />} placeholder="Search by name or domain" />
          </Field>
          <Field label="Phone" optional>
            <Input type="tel" placeholder="+15555550123" />
          </Field>
          <Field label="Locked field" help="Set by your mailbox provider.">
            <Input disabled defaultValue="smtp.example.com" />
          </Field>
          <Field label="State">
            <Select defaultValue="CA">
              <option value="CA">California</option>
              <option value="CO">Colorado</option>
              <option value="NY">New York</option>
            </Select>
          </Field>
          <Field label="Notes" help="Only you see these." className="md:col-span-2">
            <Textarea placeholder="Anything worth remembering about this broker" />
          </Field>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <RadioGroup
            legend="What to ask for"
            value={right}
            onValueChange={setRight}
            options={[
              {
                value: "both",
                label: "Opt out and delete",
                description: "Ask them to stop selling and to erase what they hold.",
              },
              { value: "opt_out", label: "Opt out of sale" },
              { value: "delete", label: "Delete my data" },
            ]}
          />
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-ink">Checkboxes</p>
            <Checkbox
              label="Follow up after 45 days"
              description="Sends one reminder if there is no answer."
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <Checkbox label="Disabled option" disabled />
            <Checkbox label="Checked and disabled" disabled defaultChecked />
            <div className="flex flex-col gap-2 rounded-md border border-line p-3">
              <Checkbox
                label="Select all"
                checked={all}
                indeterminate={some && !all}
                onChange={(event) =>
                  setRows([event.target.checked, event.target.checked, event.target.checked])
                }
              />
              {rows.map((value, index) => (
                <Checkbox
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed demo list
                  key={index}
                  label={`Row ${index + 1}`}
                  checked={value}
                  onChange={(event) =>
                    setRows(rows.map((row, at) => (at === index ? event.target.checked : row)))
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
