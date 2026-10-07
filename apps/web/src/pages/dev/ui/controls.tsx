import { Download, ExternalLink, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  Input,
  Kbd,
  LinkButton,
  RadioGroup,
  Select,
  Textarea,
} from "../../../components/ui/index.js";
import { FORCE_FOCUS, FORCE_FOCUS_FIELD, Panel, Specimen } from "./parts.js";

const WHO = [
  { value: "everyone", label: "Every target", meta: "932 targets" },
  { value: "crucial", label: "Crucial and high", meta: "74 targets" },
  { value: "unsent", label: "Not asked yet", meta: "412 targets" },
  { value: "none", label: "Nobody yet", meta: "0 targets", disabled: true },
] as const;

export function Controls() {
  const [right, setRight] = useState<"opt_out" | "delete" | "both">("both");
  const [who, setWho] = useState<(typeof WHO)[number]["value"]>("unsent");
  const [checked, setChecked] = useState(true);
  const [rows, setRows] = useState([true, false, false]);
  const all = rows.every(Boolean);
  const some = rows.some(Boolean);

  return (
    <>
      <Panel
        title="Buttons"
        description="One filled primary per panel. Danger is outlined. Disabled is a flat neutral slab, never a faded accent."
      >
        <Specimen label="Variants">
          <Button variant="primary">Send requests</Button>
          <Button>Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Delete profile</Button>
        </Specimen>
        <Specimen label="Sizes: 28, 34, 40 (44 on a phone)">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button size="lg" variant="secondary">
            Large
          </Button>
        </Specimen>
        <Specimen label="Icon buttons and link buttons">
          <IconButton label="Download report" variant="secondary">
            <Download />
          </IconButton>
          <IconButton label="Delete" size="sm">
            <Trash2 />
          </IconButton>
          <IconButton label="Delete" size="lg" variant="secondary">
            <Trash2 />
          </IconButton>
          <IconButton label="Working" loading variant="secondary">
            <Download />
          </IconButton>
          <IconButton label="Unavailable" disabled variant="secondary">
            <Download />
          </IconButton>
          <LinkButton to="/targets">Browse targets</LinkButton>
          <LinkButton to="/targets">
            Open source
            <ExternalLink aria-hidden="true" />
          </LinkButton>
        </Specimen>
        <Specimen label="Keycaps">
          <span className="flex items-center gap-1 text-meta text-ink-2">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
            <span className="ml-1">Search</span>
          </span>
          <span className="flex items-center gap-1 text-meta text-ink-2">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <span className="ml-1">Next, previous</span>
          </span>
          <span className="flex items-center gap-1 text-meta text-ink-2">
            <Kbd>Enter</Kbd>
            <span className="ml-1">Open</span>
          </span>
        </Specimen>
      </Panel>

      <Panel
        title="Button states"
        description="One button in each state. A screen has one primary; this matrix repeats it on purpose."
      >
        <Specimen label="Hover, pressed, focus (forced on)">
          <Button variant="primary" className="bg-accent-fill-hover">
            Hover
          </Button>
          <Button variant="primary" className="scale-[0.98]">
            Pressed
          </Button>
          <Button variant="primary" className={FORCE_FOCUS}>
            Focus
          </Button>
          <Button className="bg-hover">Hover</Button>
          <Button className={FORCE_FOCUS}>Focus</Button>
          <Button variant="ghost" className="bg-hover text-ink">
            Hover
          </Button>
          <Button variant="danger" className="bg-[rgb(var(--kr-danger-rgb)/0.12)]">
            Hover
          </Button>
        </Specimen>
        <Specimen label="Loading and disabled">
          <Button loading>Saving</Button>
          <Button variant="primary" disabled>
            Send requests
          </Button>
          <Button disabled>Cancel</Button>
          <Button variant="ghost" disabled>
            Skip
          </Button>
          <Button variant="danger" disabled>
            Delete profile
          </Button>
        </Specimen>
      </Panel>

      <Panel
        title="Fields"
        description="Inset in dark so a field reads as a hole in the surface. Errors land on the failing field. Help text only where a field is ambiguous."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Full name">
            <Input defaultValue="Jordan Example" />
          </Field>
          <Field label="Hover (forced)">
            <Input defaultValue="Jordan Example" className="border-ink-3" />
          </Field>
          <Field label="Focus (forced)">
            <Input defaultValue="Jordan Example" className={FORCE_FOCUS_FIELD} />
          </Field>
          <Field label="Email" error="Enter an address such as name@example.com.">
            <Input mono type="email" defaultValue="jordan@" />
          </Field>
          <Field label="Locked field">
            <Input disabled defaultValue="smtp.example.com" />
          </Field>
          <Field label="Read only">
            <Input readOnly mono defaultValue="KR-7H3K2M" />
          </Field>
          <Field label="Phone" optional help="Digits only, with the country code.">
            <Input type="tel" placeholder="+15555550123" />
          </Field>
          <Field label="Search targets" hideLabel>
            <Input leading={<Search aria-hidden="true" />} placeholder="Search by name or domain" />
          </Field>
          <Field label="State">
            <Select defaultValue="CA">
              <option value="CA">California</option>
              <option value="CO">Colorado</option>
              <option value="NY">New York</option>
            </Select>
          </Field>
          <Field label="Model" className="md:col-span-1">
            <Select mono defaultValue="a">
              <option value="a">claude-sonnet-4-6</option>
              <option value="b">claude-haiku-4-5</option>
            </Select>
          </Field>
          <Field label="Notes" className="md:col-span-2">
            <Textarea placeholder="Anything worth remembering about this target" />
          </Field>
          <Field label="Mail headers">
            <Textarea
              mono
              defaultValue={"From: jordan@example.com\nReply-To: jordan@example.com"}
            />
          </Field>
        </div>
        <Specimen label="Settings rows: label left, control right, unit in mono">
          <div className="w-full max-w-180 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            <Field layout="row" label="Check inbox every" className="px-3.5 py-2.5">
              <Input mono unit="min" defaultValue="1" inputMode="numeric" />
            </Field>
            <Field layout="row" label="Wait for a reply" className="px-3.5 py-2.5">
              <Input mono unit="d" defaultValue="45" inputMode="numeric" />
            </Field>
            <Field
              layout="row"
              label="Follow-ups"
              help="Sent when nobody answers."
              className="px-3.5 py-2.5"
            >
              <Input mono defaultValue="2" inputMode="numeric" />
            </Field>
            <Field
              layout="row"
              label="Daily limit"
              error="Use a number between 1 and 150."
              className="px-3.5 py-2.5"
            >
              <Input mono unit="msgs" defaultValue="900" inputMode="numeric" />
            </Field>
            <Field layout="row" label="Language model" className="px-3.5 py-2.5">
              <Select defaultValue="off">
                <option value="off">Off</option>
                <option value="on">On</option>
              </Select>
            </Field>
          </div>
        </Specimen>
      </Panel>

      <Panel title="Checkbox and radio">
        <div className="grid gap-6 md:grid-cols-2">
          <RadioGroup
            legend="What to ask for"
            value={right}
            onValueChange={setRight}
            options={[
              { value: "both", label: "Opt out and delete" },
              { value: "opt_out", label: "Opt out of sale" },
              { value: "delete", label: "Delete my data", disabled: true },
            ]}
          />
          <RadioGroup legend="Who (rows)" rows value={who} onValueChange={setWho} options={WHO} />
          <div className="flex flex-col gap-3">
            <p className="text-caption font-medium text-ink-2">Checkboxes</p>
            <Checkbox
              label="Follow up after 45 days"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <Checkbox label="Unchecked" />
            <Checkbox label="Disabled" disabled />
            <Checkbox label="Checked and disabled" disabled defaultChecked />
            <Checkbox label="With a description" description="Sends one reminder, then stops." />
            <Checkbox label="With an error" aria-invalid description="Tick this to continue." />
          </div>
          <div className="flex flex-col gap-2 self-start rounded-md border border-line bg-surface p-3">
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
      </Panel>
    </>
  );
}
