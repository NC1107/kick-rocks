import { Ban, MailCheck, Pencil, RotateCw } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ExternalLinkText,
  LinkTabs,
  Menu,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextLink,
} from "../../../components/ui/index.js";
import { Section, Specimen } from "./parts.js";

export function Navigation() {
  const [last, setLast] = useState("Nothing chosen yet");
  return (
    <Section
      title="Tabs, menus, links"
      description="Tabs take arrow keys, Home, and End. Menus take arrows, Home, End, a typed letter, and Escape."
    >
      <Specimen label="Tabs">
        <Tabs defaultValue="timeline" className="w-full">
          <TabList aria-label="Request details">
            <Tab value="timeline">Timeline</Tab>
            <Tab value="messages">Messages</Tab>
            <Tab value="tasks">Tasks</Tab>
            <Tab value="legal" disabled>
              Legal basis
            </Tab>
          </TabList>
          <TabPanel value="timeline">
            <p className="text-base text-ink-muted">Every change to the request, newest last.</p>
          </TabPanel>
          <TabPanel value="messages">
            <p className="text-base text-ink-muted">
              Replies from the broker, with how each was classified.
            </p>
          </TabPanel>
          <TabPanel value="tasks">
            <p className="text-base text-ink-muted">Browser and mail work done for this request.</p>
          </TabPanel>
        </Tabs>
      </Specimen>
      <Specimen label="Route tabs">
        <div className="w-full">
          <LinkTabs
            label="Settings sections"
            items={[
              { to: "/dev/ui", label: "General", end: true },
              { to: "/settings/agents", label: "Agents" },
            ]}
          />
        </div>
      </Specimen>
      <Specimen label="Menu">
        <Menu
          align="start"
          items={[
            {
              id: "edit",
              label: "Mark confirmed",
              icon: <MailCheck aria-hidden="true" />,
              onSelect: () => setLast("Mark confirmed"),
            },
            {
              id: "resend",
              label: "Send again",
              icon: <RotateCw aria-hidden="true" />,
              onSelect: () => setLast("Send again"),
            },
            {
              id: "note",
              label: "Add a note",
              icon: <Pencil aria-hidden="true" />,
              disabled: true,
              onSelect: () => setLast("Add a note"),
            },
            {
              id: "cancel",
              label: "Cancel request",
              icon: <Ban aria-hidden="true" />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setLast("Cancel request"),
            },
          ]}
          trigger={(props) => (
            <Button {...props} variant="secondary">
              Actions
            </Button>
          )}
        />
        <span className="text-sm text-ink-muted" aria-live="polite">
          {last}
        </span>
      </Specimen>
      <Specimen label="Links">
        <TextLink to="/targets">An in-app link</TextLink>
        <ExternalLinkText href="https://example.org/privacy">
          A link to another site
        </ExternalLinkText>
      </Specimen>
    </Section>
  );
}
