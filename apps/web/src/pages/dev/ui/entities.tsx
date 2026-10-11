import { Globe, MailCheck, MoreHorizontal, Plus, Star } from "lucide-react";
import {
  Button,
  Count,
  CountLink,
  EntityLink,
  EntityRow,
  FactList,
  IconAction,
  RowGroup,
  StatusMark,
  TaskStatusMark,
  useToast,
} from "../../../components/ui/index.js";
import { Panel, Specimen } from "./parts.js";

const TASK = { id: "tsk_1", kind: "email_send", status: "blocked", requestId: "req_0001" } as const;

/** The pieces that make a name, a reference or an address lead to its page, wherever it appears. */
export function Entities() {
  const toast = useToast();
  return (
    <Panel
      title="Entities"
      description="One link for anything the app names, one row to list it, one icon action for a header, and facts that stay side by side down to 360px."
    >
      <Specimen label="EntityLink: inline, quiet, and a reference in mono">
        <EntityLink to={{ kind: "target", id: "tgt_1", name: "Panera" }} />
        <EntityLink variant="quiet" to={{ kind: "profile", id: "prf_1", name: "Jordan Lee" }} />
        <EntityLink
          to={{ kind: "request", id: "req_0001", reference: "KR-7H3K2M", targetName: "Panera" }}
          show="ref"
        />
        <EntityLink to={{ kind: "mailbox", profileId: "prf_1", address: "jordan@example.com" }} />
        <EntityLink to={{ kind: "target", id: "", name: "No id, so plain text" }} />
      </Specimen>

      <Specimen label="IconAction: icon only, with a label from sm, a badge, loading, and a link">
        <IconAction label="Check for replies" icon={MailCheck} />
        <IconAction label="Add name" icon={Plus} labelFrom="sm" />
        <IconAction label="Check for replies, 23 seconds" icon={MailCheck} badge="23s" disabled />
        <IconAction label="Checking" icon={MailCheck} loading />
        <IconAction label="Make current" icon={Star} variant="ghost" />
        <IconAction label="More actions" icon={MoreHorizontal} />
        <IconAction
          label="Mailbox"
          icon={Globe}
          to={{ kind: "mailbox", profileId: "prf_1", address: "a@b.c" }}
        />
        <IconAction label="Resend" icon={MailCheck} variant="primary" labelFrom="md" />
      </Specimen>

      <Specimen label="Count and CountLink">
        <Count value={12} label="events" />
        <Count value={3} tone="attention" label="need you" />
        <Count value={2} tone="danger" label="failed" />
        <CountLink value={2} to="/requests" label="Requests" />
        <CountLink value={14} to="/requests" label="events" order="count-first" />
      </Specimen>

      <Specimen label="EntityRow: a link row, and a button row for a queue">
        <div className="w-full max-w-lg">
          <RowGroup>
            <EntityRow
              to={{ kind: "request", id: "req_0001", reference: "KR-7H3K2M", targetName: "Panera" }}
              title="Panera"
              meta="KR-7H3K2M"
              mark={<StatusMark status="awaiting_reply" />}
              trailing={<span className="font-mono text-meta text-ink-3">Oct 6</span>}
            />
            <EntityRow
              to={{ kind: "task", task: TASK }}
              title="Send email"
              meta="Stopped for you"
              mark={<TaskStatusMark status="blocked" />}
            />
            <EntityRow
              to={{ kind: "task", task: TASK }}
              title="Selected button row"
              mark={<TaskStatusMark status="queued" />}
              onSelect={() => undefined}
              selected
            />
          </RowGroup>
        </div>
      </Specimen>

      <Specimen label="FactList: auto, stacked and dense">
        <div className="grid w-full gap-4 md:grid-cols-3">
          <FactList
            items={[
              {
                term: "For",
                value: <EntityLink to={{ kind: "profile", id: "p", name: "Jordan Lee" }} />,
              },
              {
                term: "Channel",
                icon: Globe,
                value: "Web form",
                hint: "Submitted through their opt-out page",
              },
              { term: "Reference", value: "KR-7H3K2M", mono: true },
            ]}
          />
          <FactList
            layout="stacked"
            items={[
              { term: "Created", value: "Oct 6, 09:02", mono: true },
              { term: "Due", value: "Nov 5", mono: true },
            ]}
          />
          <FactList
            dense
            items={[
              { term: "Sent", value: "Oct 6", mono: true },
              { term: "Follow-ups", value: "1", mono: true },
            ]}
          />
        </div>
      </Specimen>

      <Specimen label="Toast with an action">
        <Button
          onClick={() =>
            toast.success("Created Jordan Lee", undefined, {
              action: { kind: "profile", id: "prf_1", name: "Open profile" },
            })
          }
        >
          Show a toast that links
        </Button>
      </Specimen>
    </Panel>
  );
}
