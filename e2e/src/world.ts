import type { RequestListItem, RequestStatus } from "@kickrocks/shared";
import { API_ROUTES, Api } from "./api.js";
import { eventually } from "./wait.js";

export const PASSWORD = "correct horse battery staple";

export const IDENTITIES = [
  {
    kind: "name",
    value: { first: "Jordan", last: "Example" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
  {
    kind: "email",
    value: { address: "jordan.example@example.com" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
  {
    kind: "phone",
    value: { number: "+15125550142" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
  {
    kind: "address",
    value: { street: "100 Example Street", city: "Austin", state: "TX", zip: "78701" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
  { kind: "dob", value: { date: "1990-04-12" }, isPrimary: true, validFrom: null, validTo: null },
] as const;

export const MAILBOX_ADDRESS = "jordan.example@example.com";

/** What the journey learns as it goes, shared by its steps. */
export interface World {
  api: Api;
  profileId: string;
  mcpToken: string;
  /** Request ids by target id, for the targets a campaign created a request for. */
  requestIds: Map<string, string>;
  /** The privacy address of a real broker from the dataset, which only GreenMail ever sees. */
  realBroker: { targetId: string; email: string };
}

export const world = {
  api: new Api(),
  requestIds: new Map<string, string>(),
} as unknown as World;

export async function requestFor(targetId: string): Promise<RequestListItem> {
  const page = await world.api.call(API_ROUTES.requestsList, {
    params: { id: world.profileId },
    query: { targetId, pageSize: 50 },
  });
  const [request] = page.items;
  if (!request) throw new Error(`No request for ${targetId}`);
  return request;
}

/** Waits for a request to reach one of the statuses and returns it. */
export async function waitForStatus(
  targetId: string,
  statuses: RequestStatus[],
  timeoutMs = 60_000,
): Promise<RequestListItem> {
  return eventually(
    async () => {
      const request = await requestFor(targetId);
      return statuses.includes(request.status) ? request : undefined;
    },
    { what: `${targetId} to reach ${statuses.join(" or ")}`, timeoutMs },
  );
}

async function lastPolledAt(): Promise<string | null> {
  const dashboard = await world.api.call(API_ROUTES.dashboardGet, {
    params: { id: world.profileId },
  });
  return dashboard.mailbox?.lastPolledAt ?? null;
}

/** Runs one mailbox poll through the API, as the "check now" button does, and waits for it to finish. */
export async function pollNow(): Promise<void> {
  const before = await lastPolledAt();
  const { task } = await world.api.call(API_ROUTES.mailboxPoll, {
    params: { id: world.profileId },
  });
  await eventually(
    async () => {
      const after = await lastPolledAt();
      return after !== null && after !== before ? after : undefined;
    },
    { what: `the poll ${task.id} to finish`, timeoutMs: 30_000, intervalMs: 300 },
  );
}
