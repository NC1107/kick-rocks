import { API_ROUTES, type RequestStatus } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { errorMessage, useApiQuery, useCurrentProfile } from "../../../api/index.js";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CodeBlock,
  CopyButton,
  DescriptionList,
  EmptyState,
  LinkButton,
  Pagination,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableSkeletonRows,
  TaskStatusPill,
  TextLink,
} from "../../../components/ui/index.js";
import { formatRelative } from "../../../lib/format.js";
import { CHANNEL_LABELS } from "../../../lib/labels.js";
import { REQUEST_STATUS_META, TASK_STATUS_META } from "../../../lib/status.js";
import { mcpClientConfig } from "../../settings/model.js";
import { Section, Specimen } from "./parts.js";

const ALL_STATUSES = Object.keys(REQUEST_STATUS_META) as RequestStatus[];
const ALL_TASK_STATUSES = Object.keys(TASK_STATUS_META) as (keyof typeof TASK_STATUS_META)[];

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
      <Alert intent="danger" title="Could not load requests">
        {errorMessage(query.error)}
      </Alert>
    );
  }
  if (query.data && query.data.total === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No requests yet"
        description="Requests for this profile show up here once a campaign sends them."
        actions={
          <LinkButton to="/campaigns/new" variant="primary">
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
                  <TextLink to={`/requests/${request.id}`} className="font-medium">
                    {request.target.name}
                  </TextLink>
                  <span className="ml-2 text-sm text-ink-muted">{request.reference}</span>
                </TableCell>
                <TableCell>
                  <StatusPill status={request.status} />
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{CHANNEL_LABELS[request.channel]}</Badge>
                </TableCell>
                <TableCell align="right" className="text-ink-muted">
                  {request.sentAt ? formatRelative(request.sentAt) : "Not sent"}
                </TableCell>
                <TableCell align="right" className="text-ink-muted">
                  {request.dueAt ? formatRelative(request.dueAt) : ""}
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
      <Section
        title="Status"
        description="One hue, one icon, and its own words for every request status. Task statuses and facts use the same tones."
      >
        <Specimen label="Request statuses">
          {ALL_STATUSES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </Specimen>
        <Specimen label="Task statuses">
          {ALL_TASK_STATUSES.map((status) => (
            <TaskStatusPill key={status} status={status} />
          ))}
        </Specimen>
        <Specimen label="Badges">
          <Badge>People search</Badge>
          <Badge tone="violet">Crucial</Badge>
          <Badge tone="amber">CAPTCHA</Badge>
          <Badge tone="green">Healthy</Badge>
          <Badge tone="red">Broken</Badge>
          <Badge variant="outline">Email</Badge>
          <Badge variant="outline" tone="amber">
            ID upload
          </Badge>
        </Specimen>
      </Section>

      <Section
        title="Table, live"
        description="Fed by useApiQuery against the mock API, with skeleton rows while it loads, a sort button, and pagination that keeps the old page on screen until the next arrives."
      >
        <LiveTable />
      </Section>

      <Section
        title="Cards, empty states, code"
        description="A card groups related content with a hairline. Empty states say why, then what to do."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader
              title="Mailbox"
              description="Where requests are sent from."
              actions={<Badge tone="green">Connected</Badge>}
            />
            <DescriptionList
              items={[
                { term: "Address", description: "jordan@example.com" },
                { term: "Provider", description: "Fastmail" },
                { term: "Daily cap", description: "150 messages" },
                { term: "Last checked", description: "6 minutes ago" },
              ]}
            />
          </Card>
          <EmptyState
            icon={Inbox}
            title="Nothing to review"
            description="Blocked tasks, records to confirm, and mail Kick Rocks could not classify show up here."
          />
        </div>
        <CodeBlock
          title="mcp.json"
          code={mcpClientConfig("http://localhost:8420/mcp", "krmcp_example")}
        />
        <Specimen label="Copy">
          <CopyButton value="KR-7H3K2M" label="Copy reference" />
          <CopyButton value="KR-7H3K2M" iconOnly label="Copy reference" />
        </Specimen>
      </Section>
    </>
  );
}
