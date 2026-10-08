import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { outgoingMessageId } from "@kickrocks/shared";

/** The person the synthetic inbox belongs to. Nothing here is a real address. */
export const MAILBOX_ADDRESS = "jordan@example.com";
export const PERSON_NAME = "Jordan Example";

/** The moment the harness runs at; every fixture message is dated before it. */
export const WORLD_NOW = "2026-10-08T12:00:00.000Z";
export const MAILBOX_CREATED = "2026-09-01T09:00:00.000Z";

export const FIXTURE_DKIM_SELECTOR = "kr";

/** The fixed prefix of an Ed25519 key in PKCS8 form, followed by the 32 byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * The key every fixture signature is made with. It is derived from a fixed phrase instead of being
 * stored, so regenerating the corpus produces byte-identical messages and no key sits in the
 * source. It signs nothing outside this corpus.
 */
export function fixtureDkimKey() {
  const seed = createHash("sha256").update("kick-rocks mail-intake fixture key").digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    record: `v=DKIM1; k=ed25519; p=${publicKey.subarray(-32).toString("base64")}`,
  };
}

/** Domains whose mail the fixtures sign, each served the fixture key. */
export const SIGNING_DOMAINS: readonly string[] = [
  "amazon.com",
  "netflix.com",
  "spokeo.com",
  "spokeo-support.com",
  "whitepages.com",
  "beenverified.com",
  "radaris.com",
  "intelius.com",
  "mylife.com",
  "peoplefinders.com",
  "walmart.com",
  "truthfinder.com",
  "chase.com",
  "paypal.com",
  "google.com",
  "github.com",
  "substack.com",
  "e.target.com",
  "mail.instacart.com",
  "gmail.com",
  "em.bestbuy.com",
  "shopify-mail.com",
  "linkedin.com",
  "uber.com",
];

export function dkimTestKeys(): Record<string, string> {
  const { record } = fixtureDkimKey();
  return Object.fromEntries(
    SIGNING_DOMAINS.map((domain) => [`${FIXTURE_DKIM_SELECTOR}._domainkey.${domain}`, record]),
  );
}

export type RequestKey =
  | "amazon"
  | "netflix"
  | "spokeo"
  | "whitepages"
  | "beenverified"
  | "radaris"
  | "intelius"
  | "mylife";

export interface WorldTarget {
  id: string;
  kind: "broker" | "company";
  name: string;
  domain: string;
  privacyEmail: string;
  replyDomains?: string[];
}

export interface WorldRequest {
  key: RequestKey;
  id: string;
  reference: string;
  /** The Message-ID of the mail that opened the request, which a reply quotes. */
  outgoingMessageId: string;
  targetId: string;
  channel: "email" | "form";
  status: "awaiting_reply" | "confirmed";
  rights: Array<"opt_out" | "delete">;
  sentAt: string;
  /** Set for a form submission that waits for the broker's confirmation email. */
  awaitingConfirmation: { since: string; fromDomains: string[] } | null;
}

const broker = (
  id: string,
  name: string,
  privacyLocal = "privacy",
  replyDomains?: string[],
): WorldTarget => ({
  id,
  kind: "broker",
  name,
  domain: `${id}.com`,
  privacyEmail: `${privacyLocal}@${id}.com`,
  ...(replyDomains ? { replyDomains } : {}),
});

const company = (id: string, name: string): WorldTarget => ({
  id,
  kind: "company",
  name,
  domain: `${id}.com`,
  privacyEmail: `privacy@${id}.com`,
});

/** Targets the person has a request with, and targets they do not. */
export const TARGETS: readonly WorldTarget[] = [
  company("amazon", "Amazon"),
  company("netflix", "Netflix"),
  broker("spokeo", "Spokeo", "privacy", ["spokeo-support.com"]),
  broker("whitepages", "Whitepages"),
  broker("beenverified", "BeenVerified"),
  broker("radaris", "Radaris", "support"),
  broker("intelius", "Intelius"),
  broker("mylife", "MyLife"),
  broker("peoplefinders", "PeopleFinders"),
  broker("truthfinder", "TruthFinder"),
  company("walmart", "Walmart"),
  company("bestbuy", "Best Buy"),
];

const REFERENCES: Record<RequestKey, string> = {
  amazon: "KR-4H7TQ2",
  netflix: "KR-9M3XW5",
  spokeo: "KR-7K3M9Q",
  whitepages: "KR-2D8RV6",
  beenverified: "KR-5P1CJ4",
  radaris: "KR-8N6BF3",
  intelius: "KR-3T9ZH7",
  mylife: "KR-6G2QA8",
};

interface RequestSpec {
  key: RequestKey;
  channel: "email" | "form";
  status: "awaiting_reply" | "confirmed";
  rights: Array<"opt_out" | "delete">;
  sentAt: string;
  awaitingConfirmation?: { since: string; fromDomains: string[] };
}

const REQUEST_SPECS: readonly RequestSpec[] = [
  {
    key: "amazon",
    channel: "email",
    status: "awaiting_reply",
    rights: ["delete"],
    sentAt: "2026-09-21T14:05:00.000Z",
  },
  {
    key: "netflix",
    channel: "email",
    status: "awaiting_reply",
    rights: ["delete"],
    sentAt: "2026-09-21T14:20:00.000Z",
  },
  {
    key: "spokeo",
    channel: "email",
    status: "awaiting_reply",
    rights: ["opt_out"],
    sentAt: "2026-09-22T09:10:00.000Z",
  },
  {
    key: "whitepages",
    channel: "email",
    status: "awaiting_reply",
    rights: ["opt_out"],
    sentAt: "2026-09-22T09:40:00.000Z",
  },
  {
    key: "beenverified",
    channel: "email",
    status: "awaiting_reply",
    rights: ["opt_out"],
    sentAt: "2026-09-22T10:15:00.000Z",
  },
  {
    key: "radaris",
    channel: "email",
    status: "awaiting_reply",
    rights: ["opt_out"],
    sentAt: "2026-09-23T08:30:00.000Z",
  },
  {
    key: "intelius",
    channel: "form",
    status: "awaiting_reply",
    rights: ["opt_out"],
    sentAt: "2026-09-24T16:00:00.000Z",
    awaitingConfirmation: { since: "2026-09-24T16:00:00.000Z", fromDomains: ["intelius.com"] },
  },
  {
    key: "mylife",
    channel: "email",
    status: "confirmed",
    rights: ["opt_out"],
    sentAt: "2026-08-14T10:00:00.000Z",
  },
];

/** A UUID derived from the key, so the ids in the fixtures are stable and look like the real ones. */
function stableId(key: string): string {
  const hex = createHash("sha256").update(`kick-rocks-fixture:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const REQUESTS: readonly WorldRequest[] = REQUEST_SPECS.map((spec) => {
  const id = stableId(spec.key);
  return {
    key: spec.key,
    id,
    reference: REFERENCES[spec.key],
    outgoingMessageId: outgoingMessageId(id, MAILBOX_ADDRESS.split("@")[1] as string, 0),
    targetId: spec.key,
    channel: spec.channel,
    status: spec.status,
    rights: spec.rights,
    sentAt: spec.sentAt,
    awaitingConfirmation: spec.awaitingConfirmation ?? null,
  };
});

export function requestOf(key: RequestKey): WorldRequest {
  const found = REQUESTS.find((request) => request.key === key);
  if (!found) throw new Error(`No request ${key}`);
  return found;
}

export function targetOf(id: string): WorldTarget {
  const found = TARGETS.find((target) => target.id === id);
  if (!found) throw new Error(`No target ${id}`);
  return found;
}
