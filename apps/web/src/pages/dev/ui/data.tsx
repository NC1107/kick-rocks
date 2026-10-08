import { API_ROUTES, type RequestStatus } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { Eye, Globe, Mail, Settings2, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { errorMessage, useApiQuery, useCurrentProfile } from "../../../api/index.js";
import {
  Button,
  Callout,
  CodeBlock,
  CopyButton,
  DescriptionList,
  EmptyState,
  IconButton,
  LinkButton,
  Pagination,
  Row,
  RowGroup,
  Section,
  StatusMark,
  StatusShapeGlyph,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableIdentity,
  TableRow,
  TableRowActions,
  TableSkeletonRows,
  TableToolbar,
  Tag,
  TaskStatusMark,
  Tooltip,
} from "../../../components/ui/index.js";
import { formatRelative } from "../../../lib/format.js";
import { CHANNEL_LABELS } from "../../../lib/labels.js";
import {
  REQUEST_STATUS_META,
  type StatusFamily,
  type StatusShape,
  TASK_STATUS_META,
} from "../../../lib/status.js";
import { mcpClientConfig } from "../../settings/model.js";
import { Panel, Specimen } from "./parts.js";

const ALL_STATUSES = Object.keys(REQUEST_STATUS_META) as RequestStatus[];
const ALL_TASK_STATUSES = Object.keys(TASK_STATUS_META) as (keyof typeof TASK_STATUS_META)[];

const LEGEND: readonly { family: StatusFamily; shape: StatusShape; label: string; note: string }[] =
  [
    { family: "progress", shape: "ring", label: "Queued", note: "ring" },
    { family: "progress", shape: "ring-dot", label: "Sent", note: "ring with a centre dot" },
    { family: "progress", shape: "dashed-ring", label: "Draft", note: "dashed ring" },
    { family: "progress", shape: "running", label: "Running", note: "turning ring" },
    { family: "resolved", shape: "disc", label: "Resolved", note: "filled disc" },
    { family: "needs", shape: "triangle", label: "Needs you", note: "filled triangle" },
    { family: "failed", shape: "square", label: "Failed", note: "filled square" },
    { family: "closed", shape: "dash", label: "Cancelled", note: "short dash" },
  ];

const SAMPLE_ROWS = [
  {
    id: 1,
    name: "ClearCheck",
    domain: "clearcheck.example",
    status: "awaiting_reply",
    asked: "opt-out · delete",
    sent: "Oct 6",
    due: "in 38 d",
  },
  {
    id: 2,
    name: "AudienceGrid",
    domain: "audiencegrid.example",
    status: "needs_verification",
    asked: "delete",
    sent: "Oct 5",
    due: "in 12 d",
  },
  {
    id: 3,
    name: "Fixture Verify Data Holdings International",
    domain: "fixture-verify-data-holdings.example",
    status: "confirmed",
    asked: "opt-out",
    sent: "Sep 28",
    due: "-",
  },
  {
    id: 4,
    name: "PeopleFindr",
    domain: "peoplefindr.example",
    status: "rejected",
    asked: "opt-out · delete",
    sent: "Sep 21",
    due: "-",
  },
] as const satisfies readonly {
  id: number;
  name: string;
  domain: string;
  status: RequestStatus;
  asked: string;
  sent: string;
  due: string;
}[];

function LedgerSpecimen() {
  const [selected, setSelected] = useState<number | null>(2);
  return (
    <div>
      <TableToolbar count="932 targets">
        <span className="font-mono text-meta text-ink-3">Type: all</span>
      </TableToolbar>
      <Table label="Sample requests" role="grid" maxHeight="18rem">
        <TableHead>
          <tr>
            <TableHeaderCell>Target</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Asked</TableHeaderCell>
            <TableHeaderCell align="right">Sent</TableHeaderCell>
            <TableHeaderCell align="right">Due</TableHeaderCell>
            <TableHeaderCell className="w-24">
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {SAMPLE_ROWS.map((row) => (
            <TableRow
              key={row.id}
              selected={selected === row.id}
              onPick={() => setSelected(row.id)}
            >
              <TableCell className="max-w-72">
                <TableIdentity title={row.name} meta={row.domain} />
              </TableCell>
              <TableCell>
                <StatusMark status={row.status} />
              </TableCell>
              <TableCell mono className="text-ink-2">
                {row.asked}
              </TableCell>
              <TableCell kind="date" className="text-ink-2">
                {row.sent}
              </TableCell>
              <TableCell kind="date" className="text-ink-2">
                {row.due}
              </TableCell>
              <TableCell>
                <TableRowActions>
                  <IconButton label={`Open ${row.name}`} size="sm">
                    <Eye />
                  </IconButton>
                  <IconButton label={`Delete ${row.name}`} size="sm">
                    <Trash2 />
                  </IconButton>
                </TableRowActions>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        page={1}
        pageSize={50}
        total={932}
        onPageChange={() => undefined}
        noun="targets"
      />
    </div>
  );
}

function LiveTable() {
  const { profile } = useCurrentProfile();
  const [page, setPage] = useState(1);
  const [sortAsc, setSortAsc] = useState(false);
  const query = useApiQuery(
    API_ROUTES.requestsList,
    profile
      ? { params: { id: profile.id }, query: { page, pageSize: 6 }, keepPrevious: true }
      : skipToken,
  );

  if (query.isError) {
    return (
      <Callout intent="danger" title="Could not load requests">
        {errorMessage(query.error)}
      </Callout>
    );
  }
  if (query.data && query.data.total === 0) {
    return (
      <EmptyState
        title="No requests yet."
        actions={
          <LinkButton to="/campaigns/new" size="sm">
            Start a campaign
          </LinkButton>
        }
      />
    );
  }
  const items = query.data?.items ?? [];
  const rows = sortAsc
    ? [...items].sort((a, b) => a.target.name.localeCompare(b.target.name))
    : items;

  return (
    <div>
      <Table label="Requests, live from the mock API">
        <TableHead>
          <tr>
            <TableHeaderCell
              sortDirection={sortAsc ? "asc" : null}
              onSort={() => setSortAsc((value) => !value)}
            >
              Target
            </TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Channel</TableHeaderCell>
            <TableHeaderCell align="right">Sent</TableHeaderCell>
            <TableHeaderCell align="right">Answer due</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {query.isPending ? (
            <TableSkeletonRows columns={5} rows={6} />
          ) : (
            rows.map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  <TableIdentity
                    title={request.target.name}
                    to={`/requests/${request.id}`}
                    meta={request.reference}
                  />
                </TableCell>
                <TableCell>
                  <StatusMark status={request.status} />
                </TableCell>
                <TableCell className="text-ink-2">{CHANNEL_LABELS[request.channel]}</TableCell>
                <TableCell kind="date" className="text-ink-2">
                  {request.sentAt ? formatRelative(request.sentAt) : "-"}
                </TableCell>
                <TableCell kind="date" className="text-ink-2">
                  {request.dueAt ? formatRelative(request.dueAt) : "-"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {query.data ? (
        <Pagination
          page={query.data.page}
          pageSize={query.data.pageSize}
          total={query.data.total}
          onPageChange={setPage}
          noun="requests"
        />
      ) : null}
    </div>
  );
}

export function DataDisplay() {
  return (
    <>
      <Panel
        title="Status marks"
        description="A 10px shape and a plain word, no pill. Only Needs you and Failed take color in the word. The description is a tooltip; hover or focus a mark."
      >
        <Specimen label="Shapes, one per meaning">
          {LEGEND.map((item) => (
            <div
              key={item.label}
              className="flex w-44 items-center gap-2.5 rounded-sm border border-line bg-surface px-3 py-2"
            >
              <StatusShapeGlyph shape={item.shape} />
              <span className="flex flex-col">
                <span className="text-meta text-ink">{item.label}</span>
                <span className="text-caption text-ink-3">{item.note}</span>
              </span>
            </div>
          ))}
        </Specimen>
        <Specimen label="Request statuses">
          {ALL_STATUSES.map((status) => (
            <span key={status} className="w-40">
              <StatusMark status={status} />
            </span>
          ))}
        </Specimen>
        <Specimen label="Task statuses">
          {ALL_TASK_STATUSES.map((status) => (
            <span key={status} className="w-40">
              <TaskStatusMark status={status} />
            </span>
          ))}
        </Specimen>
        <Specimen label="Tags: outlined, mono, never tinted">
          <Tag>Email</Tag>
          <Tag>Web form</Tag>
          <Tag>People search</Tag>
          <Tag tone="attention">CAPTCHA</Tag>
          <Tag tone="attention">Phone call</Tag>
          <Tag tone="attention">ID upload</Tag>
        </Specimen>
        <Specimen label="Tooltip: 600ms on hover, at once on focus">
          <Tooltip content="Sent, and the company has until the due date to answer.">
            <Button size="sm">Hover or focus me</Button>
          </Tooltip>
        </Specimen>
      </Panel>

      <Panel
        title="Section and row group"
        description="A mono label with the count folded in, then one bordered group of rows. No card, no title plus description."
      >
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Section label="Needs you" count={3}>
            <RowGroup>
              <Row
                to="/review"
                title="ClearCheck"
                description="Asked for a copy of ID"
                trailing={<span className="font-mono text-meta text-attention-text">2d</span>}
              />
              <Row
                onClick={() => undefined}
                title="AudienceGrid"
                description="Reply could not be sorted"
                trailing={<span className="font-mono text-meta text-ink-3">5h</span>}
              />
              <Row
                selected
                onClick={() => undefined}
                title="PeopleFindr (selected)"
                description="Needs verification"
                trailing={<span className="font-mono text-meta text-ink-3">1h</span>}
              />
            </RowGroup>
          </Section>
          <Section
            label="Mailbox"
            actions={
              <Button size="sm" variant="ghost">
                Edit
              </Button>
            }
          >
            <RowGroup>
              <Row
                icon={Mail}
                title="Address"
                description="Where requests are sent from"
                trailing={
                  <span className="font-mono text-meta text-ink-2">jordan@example.com</span>
                }
              />
              <Row icon={UserRound} title="Profile" trailing={<Tag>Current</Tag>} />
              <Row
                icon={Globe}
                title="Provider with a very long name that has to truncate before it pushes the value out"
                description="Fastmail, connected through IMAP and SMTP with an app password"
                trailing={<StatusMark status="confirmed" />}
              />
              <Row
                icon={Settings2}
                title="Daily limit"
                trailing={<span className="font-mono text-meta text-ink-2">150</span>}
              />
            </RowGroup>
          </Section>
        </div>
        <Specimen label="Definition list">
          <div className="w-full max-w-lg">
            <DescriptionList
              items={[
                { term: "Reference", description: <span className="font-mono">KR-7H3K2M</span> },
                { term: "Asked", description: <span className="font-mono">opt-out · delete</span> },
                { term: "Sent", description: <span className="font-mono">Oct 6, 09:02</span> },
              ]}
            />
          </div>
        </Specimen>
      </Panel>

      <Panel
        title="Ledger table"
        description="36px rows, 45px with a second line, a 32px sticky mono header, hover actions, accent wash plus marker on the selected row. Click a row, or Tab to the table and use the arrow keys with Enter."
      >
        <LedgerSpecimen />
        <Specimen label="Focus on a selected row: ring inside the edge, marker on the left">
          <div className="grid w-full gap-4 md:grid-cols-2">
            <RowGroup>
              <Row
                onClick={() => undefined}
                title="ClearCheck"
                description="Asked for a copy of ID"
              />
              <Row
                selected
                onClick={() => undefined}
                title="PeopleFindr"
                description="Selected and focused"
                className="outline-2 -outline-offset-2 outline-focus"
              />
              <Row onClick={() => undefined} title="AudienceGrid" description="Neither" />
            </RowGroup>
            <Table label="Focused and selected row" role="grid">
              <TableBody>
                <TableRow
                  selected
                  onPick={() => undefined}
                  className="outline-2 outline-focus -outline-offset-2"
                >
                  <TableCell>
                    <TableIdentity title="PeopleFindr" meta="peoplefindr.example" />
                  </TableCell>
                  <TableCell>
                    <StatusMark status="rejected" />
                  </TableCell>
                </TableRow>
                <TableRow onPick={() => undefined}>
                  <TableCell>
                    <TableIdentity title="ClearCheck" meta="clearcheck.example" />
                  </TableCell>
                  <TableCell>
                    <StatusMark status="awaiting_reply" />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Specimen>
        <Specimen label="Loading">
          <div className="w-full">
            <Table label="Loading placeholder">
              <TableHead>
                <tr>
                  <TableHeaderCell>Target</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Sent</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                <TableSkeletonRows columns={3} rows={3} />
              </TableBody>
            </Table>
          </div>
        </Specimen>
        <Specimen label="Live, from the mock API">
          <div className="w-full">
            <LiveTable />
          </div>
        </Specimen>
      </Panel>

      <Panel title="Code and copy">
        <CodeBlock
          title="mcp.json"
          code={mcpClientConfig("http://localhost:8420/mcp", "krmcp_example")}
        />
        <Specimen label="Copy">
          <CopyButton value="KR-7H3K2M" label="Copy reference" />
          <CopyButton value="KR-7H3K2M" iconOnly label="Copy reference" />
        </Specimen>
      </Panel>
    </>
  );
}
