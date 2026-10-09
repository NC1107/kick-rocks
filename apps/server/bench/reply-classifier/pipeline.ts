import { outgoingMessageId, type ReplyClassification } from "@kickrocks/shared";
import { CONFIDENCE_THRESHOLD, createReplyClassifier } from "../../src/mail/classifier.js";
import { parseInboxMessage } from "../../src/mail/parse.js";
import { extractLinks, stripQuoted } from "../../src/mail/reply-text.js";
import type {
  ClassificationResult,
  ClassifierRequest,
  InboxMessage,
} from "../../src/mail/types.js";
import type { Item, ModelInput, Outcome, ReplyModel } from "./types.js";

const REQUEST_ID = "bench-request";
const REFERENCE = "KR-7K3M9Q";
const MAILBOX_DOMAIN = "bench.example";
const MAX_BODY_CHARS = 50_000;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Every item is treated as a reply to one known request that the sender is entitled to answer, so
 * what is measured is the reading of the text. Routing and sender trust have their own harness.
 * The request's sites are the sender's host and the hosts the message links to, because a
 * confirmation link only counts on a request's own site.
 */
function requestFor(message: InboxMessage): ClassifierRequest {
  const senderHost = message.from.address.split("@").pop()?.toLowerCase() ?? "";
  const linkHosts = extractLinks(message.html, message.text)
    .map((link) => hostOf(link.url))
    .filter((host): host is string => host !== null);
  const domains = [...new Set([senderHost, ...linkHosts].filter((host) => host !== ""))];
  return {
    id: REQUEST_ID,
    reference: REFERENCE,
    outgoingMessageId: outgoingMessageId(REQUEST_ID, MAILBOX_DOMAIN),
    status: "awaiting_reply",
    channel: "email",
    targetId: "bench-target",
    targetName: "Bench Target",
    targetDomain: senderHost || "broker.example",
    replyDomains: domains,
    curatedReplyDomains: [],
    replyAddresses: [],
    recordUrl: null,
    awaitingConfirmation: null,
  };
}

async function messageFor(item: Item, uid: number): Promise<InboxMessage> {
  const outgoing = outgoingMessageId(REQUEST_ID, MAILBOX_DOMAIN);
  const base: InboxMessage =
    item.raw !== null
      ? await parseInboxMessage({ uid, source: Buffer.from(item.raw) })
      : {
          uid,
          messageId: null,
          inReplyTo: null,
          references: [],
          from: { name: null, address: item.fromAddress },
          to: [],
          subject: item.subject,
          date: null,
          text: item.body,
          html: null,
          isBounce: false,
          autoSubmitted: false,
          headers: {},
          verifyDkim: async () => [],
        };
  const domain = base.from.address.split("@").pop()?.toLowerCase() ?? "";
  return {
    ...base,
    inReplyTo: outgoing,
    references: [outgoing],
    // A signature that covers the request's Message-ID, so trust caps never hide what the rules read.
    verifyDkim: async () => [
      { domain, inReplyTo: [outgoing], references: [outgoing], subject: [base.subject] },
    ],
  };
}

export interface PreparedItem {
  item: Item;
  message: InboxMessage;
  request: ClassifierRequest;
}

export async function prepare(items: readonly Item[]): Promise<PreparedItem[]> {
  const prepared: PreparedItem[] = [];
  for (const [index, item] of items.entries()) {
    const message = await messageFor(item, index + 1);
    prepared.push({ item, message, request: requestFor(message) });
  }
  return prepared;
}

export function modelInputOf(message: InboxMessage): ModelInput {
  return { subject: message.subject, body: stripQuoted(message.text).slice(0, MAX_BODY_CHARS) };
}

const rulesOnly = createReplyClassifier({ settings: { get: () => null as never } });

export function rulesStage(prepared: PreparedItem): Promise<ClassificationResult> {
  return rulesOnly.classify(prepared.message, { requests: [prepared.request] });
}

function now(): number {
  return performance.now();
}

/** The rules alone: whatever they cannot place stays below the threshold and waits for a person. */
export async function runRulesOnly(items: readonly Item[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const prepared of await prepare(items)) {
    const start = now();
    const result = await rulesStage(prepared);
    outcomes.push({
      label: result.classification,
      confidence: result.confidence,
      via: "rules",
      latencyMs: now() - start,
      modelLatencyMs: null,
    });
  }
  return outcomes;
}

/**
 * The production order with another model in the language model's place: rules first, and the
 * model only for what they leave under the confidence threshold.
 */
export async function runRulesFirst(
  items: readonly Item[],
  model: ReplyModel,
  modelOnly = false,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const prepared of await prepare(items)) {
    const start = now();
    const rules = await rulesStage(prepared);
    if (!modelOnly && rules.confidence >= CONFIDENCE_THRESHOLD) {
      outcomes.push({
        label: rules.classification,
        confidence: rules.confidence,
        via: "rules",
        latencyMs: now() - start,
        modelLatencyMs: null,
      });
      continue;
    }
    const modelStart = now();
    const prediction = await model.predict(modelInputOf(prepared.message));
    const modelLatencyMs = now() - modelStart;
    const label: ReplyClassification = prediction?.label ?? rules.classification;
    outcomes.push({
      label,
      confidence: prediction?.confidence ?? rules.confidence,
      via: prediction ? "model" : "rules",
      latencyMs: now() - start,
      modelLatencyMs,
    });
  }
  return outcomes;
}

/** The existing classifier end to end, with its language model step pointed at the given settings. */
export async function runProduction(
  items: readonly Item[],
  llm: { baseUrl: string; model: string; apiKey: string | null },
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): Promise<Outcome[]> {
  const send = fetchImpl ?? fetch;
  let spentInModel = 0;
  const timedFetch: typeof fetch = async (input, init) => {
    const started = now();
    try {
      return await send(input, init);
    } finally {
      spentInModel += now() - started;
    }
  };
  const classifier = createReplyClassifier({
    settings: { get: () => llm as never },
    llmTimeoutMs: timeoutMs,
    fetch: timedFetch,
  });
  const outcomes: Outcome[] = [];
  for (const prepared of await prepare(items)) {
    spentInModel = 0;
    const start = now();
    const result = await classifier.classify(prepared.message, { requests: [prepared.request] });
    const latencyMs = now() - start;
    const viaModel = result.rationale.startsWith("Model:");
    outcomes.push({
      label: result.classification,
      confidence: result.confidence,
      via: viaModel ? "model" : "rules",
      latencyMs,
      modelLatencyMs: spentInModel > 0 ? spentInModel : null,
    });
  }
  return outcomes;
}
