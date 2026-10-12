import { execFileSync } from "node:child_process";
import { outgoingMessageId, ProfileField, type ReplyClassification } from "@kickrocks/shared";
import { createReplyClassifier } from "../../src/mail/classifier.js";
import { LLM_TIMEOUT_MS } from "../../src/mail/llm.js";
import type { ReplyModelHost } from "../../src/mail/reply-model/types.js";
import type {
  ClassificationResult,
  ClassifierRequest,
  InboxMessage,
} from "../../src/mail/types.js";
import type { RealReply } from "./real-corpus.js";

const REQUEST_ID = "bench-request";
const TARGET_ID = "bench-target";
const MAILBOX_DOMAIN = "bench.example";

/** Whether the open request carries the company's name, which is what the name gate looks for. */
export type NameScenario = "named" | "unnamed";

export interface RealOutcome {
  truth: ReplyClassification;
  /** What a person would see: the applied label, or else the suggestion, or else the rules' reading. */
  label: ReplyClassification;
  confidence: number;
  apply: boolean;
  source: ClassificationResult["source"];
}

function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "company"
  );
}

/** The company's own mail domain, which is where a genuine reply to its request comes from. */
function senderHostOf(reply: RealReply): string {
  return `${slugOf(reply.company)}.bench-target.com`;
}

/**
 * The reply carries no thread headers, so only its sender ties it to the open request, which is
 * the one case the name gate guards. It comes from the company's own domain, as a genuine reply
 * does, and a signature covers the request's id so trust caps never hide what is read.
 * When the request is for another company, neither the sender nor the text names it.
 */
export function requestFor(reply: RealReply, scenario: NameScenario): ClassifierRequest {
  const named = scenario === "named";
  const host = named ? senderHostOf(reply) : "other-company.bench-target.com";
  return {
    id: REQUEST_ID,
    open: true,
    targetKind: "broker",
    contactAddress: null,
    sentAt: null,
    reference: "KR-7K3M9Q",
    outgoingMessageId: outgoingMessageId(REQUEST_ID, MAILBOX_DOMAIN),
    status: "awaiting_reply",
    channel: "email",
    targetId: TARGET_ID,
    targetName: named ? reply.company : "Other Company",
    targetDomain: host,
    replyDomains: [host],
    curatedReplyDomains: [],
    replyAddresses: [],
    recordUrl: null,
    awaitingConfirmation: null,
  };
}

export function messageFor(reply: RealReply, uid: number): InboxMessage {
  const outgoing = outgoingMessageId(REQUEST_ID, MAILBOX_DOMAIN);
  return {
    uid,
    messageId: null,
    inReplyTo: null,
    references: [],
    from: { name: null, address: `privacy@${senderHostOf(reply)}` },
    to: [],
    subject: reply.subject,
    date: null,
    text: reply.body,
    html: null,
    isBounce: false,
    autoSubmitted: false,
    headers: {},
    originalMessageIds: [],
    verifyDkim: async (domains) =>
      domains.map((domain) => ({
        domain,
        inReplyTo: [outgoing],
        references: [outgoing],
        subject: [reply.subject],
      })),
  };
}

export interface LlmSetup {
  baseUrl: string;
  model: string;
  /** Replaces the shipped system prompt in each request, to measure another version. */
  systemPrompt: string | null;
  thinkingOff: boolean;
}

function llmFetch(setup: LlmSetup): typeof fetch {
  return (input, init) => {
    const body: Record<string, unknown> =
      typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (setup.thinkingOff) body.reasoning_effort = "none";
    if (setup.systemPrompt !== null && Array.isArray(body.messages)) {
      body.messages = body.messages.map((message: { role: string; content: string }) =>
        message.role === "system" ? { ...message, content: setup.systemPrompt } : message,
      );
    }
    return fetch(input, { ...init, body: JSON.stringify(body) });
  };
}

export interface RealApproach {
  model?: ReplyModelHost;
  llm?: LlmSetup;
}

/** The system prompt of `src/mail/llm.ts` as a branch or commit has it, read without checking it out. */
export function systemPromptAt(ref: string, repoDir: string): string {
  const source = execFileSync("git", ["show", `${ref}:apps/server/src/mail/llm.ts`], {
    cwd: repoDir,
    encoding: "utf8",
  });
  const match = source.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;\n/);
  if (!match?.[1]) throw new Error(`${ref} has no SYSTEM_PROMPT in apps/server/src/mail/llm.ts`);
  return match[1].replace(
    /\$\{ProfileField\.options\.join\(", "\)\}/,
    ProfileField.options.join(", "),
  );
}

/** Runs the shipped classifier over every reply, one at a time, against its single open request. */
export async function classifyReplies(
  replies: readonly RealReply[],
  scenario: NameScenario,
  approach: RealApproach,
  log: (message: string) => void = () => {},
): Promise<RealOutcome[]> {
  const llm = approach.llm;
  const classifier = createReplyClassifier({
    settings: {
      get: ((key: string) =>
        key === "llm" && llm
          ? { baseUrl: llm.baseUrl, model: llm.model, apiKey: null }
          : null) as never,
    },
    ...(llm ? { fetch: llmFetch(llm), llmTimeoutMs: LLM_TIMEOUT_MS } : {}),
    ...(approach.model ? { model: approach.model } : {}),
  });
  const outcomes: RealOutcome[] = [];
  for (const [index, reply] of replies.entries()) {
    const result = await classifier.classify(messageFor(reply, index + 1), {
      requests: [requestFor(reply, scenario)],
      senderTargetIds: [TARGET_ID],
    });
    const suggestion = result.apply ? null : result.suggestion;
    outcomes.push({
      truth: reply.truth,
      label: suggestion?.classification ?? result.classification,
      confidence: suggestion?.confidence ?? result.confidence,
      apply: result.apply,
      source: result.source,
    });
    if ((index + 1) % 25 === 0) log(`  ${index + 1} of ${replies.length}`);
  }
  return outcomes;
}
