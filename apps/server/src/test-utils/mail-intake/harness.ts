import { type MessageRow, mailboxes, messages, replyPredictions, requests } from "@kickrocks/db";
import type { ReplyClassification } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { createReplyClassifier } from "../../mail/classifier.js";
import { createDkimVerifier } from "../../mail/dkim.js";
import { parseInboxMessage } from "../../mail/parse.js";
import { RULES_THRESHOLD } from "../../mail/thresholds.js";
import type { InboxMessage, ReplyClassifier } from "../../mail/types.js";
import { createRunners } from "../../runners/index.js";
import { createTestContext, type TestContext } from "../context.js";
import { seedMailbox, seedProfile, seedTarget } from "../seed.js";
import { type CorpusMessage, type CorpusSet, loadCorpus } from "./corpus.js";
import {
  dkimTestKeys,
  MAILBOX_ADDRESS,
  MAILBOX_ALIAS,
  MAILBOX_CREATED,
  REQUESTS,
  requestOf,
  TARGETS,
  WORLD_NOW,
  type WorldRequest,
} from "./world.js";

export interface Metrics {
  /** Mail that should be ignored but was attached to a request, classified as something, or shown in Review. */
  falsePositives: number;
  /** Mail about a request that was missed, or that should wait in Review and does not. */
  falseNegatives: number;
  /** Mail that should be ignored whose subject or body was kept. */
  storedIgnored: number;
  /** Mail about a request that was attached to the wrong request or given the wrong class. */
  misrouted: number;
}

export interface Failure {
  file: string;
  category: string;
  problem: keyof Metrics;
  detail: string;
}

export interface CategoryReport extends Metrics {
  category: string;
  total: number;
}

export interface IntakeReport {
  set: CorpusSet;
  total: number;
  ignoreMail: number;
  requestMail: number;
  metrics: Metrics;
  /** Context the four numbers do not carry. */
  extra: {
    stored: number;
    shownInReview: number;
    /** Request mail that waited in Review although it could have been applied or recorded without a person. */
    needlessReview: number;
    /**
     * Request mail the rules read correctly that waits in Review all the same: its rule is not on
     * the proven list, or an earlier reply that is only a suggestion left the request open.
     */
    heldForPerson: number;
    /** Messages the classifier sent to the language model. */
    modelCalls: number;
    /** Bodies downloaded for messages that ended up ignored. Near zero when the server can search. */
    downloadedIgnored: number;
    /** Each message's end state, by file, so two runs can be compared for identical verdicts. */
    verdicts: Record<string, string>;
  };
  categories: CategoryReport[];
  failures: Failure[];
}

interface Fixture {
  ctx: TestContext;
  requestIds: Map<string, string>;
  modelCalls: () => number;
}

/** A model that has no opinion, so the numbers measure the rules and the routing alone. */
function undecidedModel() {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                classification: "unknown",
                confidence: 0.3,
                rationale: "fixture model",
                requested_fields: [],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

function seedWorld(ctx: TestContext): { requestIds: Map<string, string>; mailboxId: string } {
  const profile = seedProfile(ctx);
  const mailbox = seedMailbox(ctx, profile.id, { address: MAILBOX_ADDRESS });
  // A poll never reads before the mailbox existed, so the mailbox predates every request.
  ctx.services.db
    .update(mailboxes)
    .set({
      createdAt: MAILBOX_CREATED,
      replyAlias: MAILBOX_ALIAS,
      replyAliasVerifiedAt: MAILBOX_CREATED,
    })
    .where(eq(mailboxes.id, mailbox.id))
    .run();
  for (const target of TARGETS) {
    seedTarget(ctx, {
      kind: target.kind,
      id: target.id,
      name: target.name,
      domain: target.domain,
      privacyEmail: target.privacyEmail,
      ...(target.replyDomains ? { replyDomains: target.replyDomains } : {}),
    });
  }
  const requestIds = new Map<string, string>();
  for (const request of REQUESTS) {
    insertRequest(ctx, profile.id, mailbox.id, request);
    requestIds.set(request.key, request.id);
  }
  return { requestIds, mailboxId: mailbox.id };
}

function insertRequest(
  ctx: TestContext,
  profileId: string,
  mailboxId: string,
  request: WorldRequest,
): void {
  ctx.services.db
    .insert(requests)
    .values({
      id: request.id,
      profileId,
      targetId: request.targetId,
      mailboxId,
      rights: request.rights,
      legalBasis: "policy",
      channel: request.channel,
      status: request.status,
      reference: request.reference,
      outgoingMessageId: request.outgoingMessageId,
      sentAt: request.sentAt,
      awaitingConfirmationSince: request.awaitingConfirmation?.since ?? null,
      createdAt: request.sentAt,
      updatedAt: request.sentAt,
    })
    .run();
  if (request.awaitingConfirmation) {
    ctx.services.requests.addEvent(request.id, {
      type: "awaiting_confirmation",
      actor: "system",
      payload: { fromDomains: request.awaitingConfirmation.fromDomains, linkTextPattern: null },
    });
  }
}

async function deliverCorpus(
  ctx: TestContext,
  corpus: CorpusMessage[],
): Promise<Map<string, string>> {
  const verifier = createDkimVerifier({
    testKeys: dkimTestKeys(),
    resolver: async (name) => {
      throw Object.assign(new Error(`no record for ${name}`), { code: "ENOTFOUND" });
    },
  }).forRun();
  const mailbox = ctx.mail.mailbox(MAILBOX_ADDRESS);
  const messageIds = new Map<string, string>();
  for (const [index, message] of corpus.entries()) {
    const parsed: InboxMessage = await parseInboxMessage({
      uid: index + 1,
      source: message.raw,
      dkim: verifier,
    });
    if (!parsed.messageId) throw new Error(`${message.file} has no Message-ID`);
    messageIds.set(message.file, parsed.messageId);
    mailbox.deliver(parsed);
  }
  return messageIds;
}

function describeRow(row: MessageRow): string {
  return `${row.classification} ${row.confidence.toFixed(2)}, ${row.requestId ? "attached" : "unattached"}, ${row.reviewed ? "handled" : "in Review"}`;
}

function judge(
  label: CorpusMessage,
  row: MessageRow | undefined,
  requestIds: Map<string, string>,
): { problems: Array<{ problem: keyof Metrics; detail: string }>; needlessReview: boolean } {
  const problems: Array<{ problem: keyof Metrics; detail: string }> = [];
  if (label.outcome === "ignore") {
    if (row) {
      problems.push({ problem: "storedIgnored", detail: `kept "${row.subject}"` });
      const classified = row.classification !== "unrelated";
      if (row.requestId !== null || classified || !row.reviewed) {
        problems.push({ problem: "falsePositives", detail: describeRow(row) });
      }
    }
    return { problems, needlessReview: false };
  }

  if (!row) {
    problems.push({ problem: "falseNegatives", detail: "not stored" });
    return { problems, needlessReview: false };
  }
  const expectedId = label.request ? requestIds.get(label.request) : undefined;
  const expectedClass: ReplyClassification | null = label.classification;
  const attachedElsewhere = row.requestId !== null && row.requestId !== expectedId;
  const wrongClass = row.requestId !== null && row.classification !== expectedClass;

  if (label.outcome === "review") {
    if (row.reviewed)
      problems.push({ problem: "falseNegatives", detail: `not shown: ${describeRow(row)}` });
    if (attachedElsewhere || wrongClass) {
      problems.push({ problem: "misrouted", detail: describeRow(row) });
    }
    return { problems, needlessReview: false };
  }

  if (row.requestId !== expectedId || row.classification !== expectedClass) {
    problems.push({ problem: "misrouted", detail: describeRow(row) });
  }
  // A broker asking for anything is the person's to answer even when the request is over, so it
  // is not a review a rule could have saved.
  const asksPerson = row.classification === "verification_required";
  return { problems, needlessReview: !row.reviewed && problems.length === 0 && !asksPerson };
}

export async function runIntake(
  set: CorpusSet = "dev",
  options: {
    classifier?: (ctx: TestContext, model: typeof fetch) => ReplyClassifier;
    /** False simulates a mail server that refuses SEARCH. */
    searchSupported?: boolean;
  } = {},
): Promise<IntakeReport> {
  const corpus = loadCorpus(set);
  const ctx = await createTestContext({ now: WORLD_NOW });
  try {
    const model = undecidedModel();
    ctx.services.settings.set("llm", {
      baseUrl: "http://model.test/v1",
      model: "fixture",
      apiKey: null,
    });
    const classifier =
      options.classifier?.(ctx, model.fetchImpl) ??
      createReplyClassifier({ settings: ctx.services.settings, fetch: model.fetchImpl });
    (ctx.services.mail as { classifier: ReplyClassifier }).classifier = classifier;

    const { requestIds, mailboxId } = seedWorld(ctx);
    const fixture: Fixture = { ctx, requestIds, modelCalls: model.calls };
    const messageIds = await deliverCorpus(ctx, corpus);
    ctx.mail.mailbox(MAILBOX_ADDRESS).searchSupported = options.searchSupported ?? true;

    const runners = createRunners(ctx.services, { random: () => 0 });
    ctx.services.dispatch.enqueueInboxPoll(mailboxId);
    await runners.inbox.runDue();

    return report(set, corpus, messageIds, fixture, mailboxId, [
      ...ctx.mail.mailbox(MAILBOX_ADDRESS).fetched,
    ]);
  } finally {
    await ctx.close();
  }
}

function report(
  set: CorpusSet,
  corpus: CorpusMessage[],
  messageIds: Map<string, string>,
  { ctx, requestIds, modelCalls }: Fixture,
  mailboxId: string,
  fetchedUids: number[],
): IntakeReport {
  const rows = ctx.services.db
    .select()
    .from(messages)
    .where(eq(messages.mailboxId, mailboxId))
    .all();
  const byMessageId = new Map(rows.map((row) => [row.messageIdHeader, row]));
  const predictions = new Map(
    ctx.services.db
      .select()
      .from(replyPredictions)
      .all()
      .map((row) => [row.messageId, row]),
  );

  const metrics: Metrics = { falsePositives: 0, falseNegatives: 0, storedIgnored: 0, misrouted: 0 };
  const perCategory = new Map<string, CategoryReport>();
  const failures: Failure[] = [];
  let needlessReview = 0;
  let heldForPerson = 0;
  let downloadedIgnored = 0;
  const verdicts: Record<string, string> = {};
  const fetched = new Set(fetchedUids);

  for (const [index, label] of corpus.entries()) {
    const category =
      perCategory.get(label.category) ??
      ({
        category: label.category,
        total: 0,
        falsePositives: 0,
        falseNegatives: 0,
        storedIgnored: 0,
        misrouted: 0,
      } satisfies CategoryReport);
    perCategory.set(label.category, category);
    category.total += 1;

    const messageId = messageIds.get(label.file);
    const row = messageId ? byMessageId.get(messageId) : undefined;
    const verdict = judge(label, row, requestIds);
    verdicts[label.file] = row ? describeRow(row) : "ignored";
    if (!row && fetched.has(index + 1)) downloadedIgnored += 1;
    if (verdict.needlessReview && row) {
      const prediction = predictions.get(row.id);
      const held =
        prediction !== undefined &&
        prediction.rulesLabel === label.classification &&
        prediction.rulesConfidence >= RULES_THRESHOLD;
      if (held) heldForPerson += 1;
      else {
        needlessReview += 1;
      }
    }
    for (const { problem, detail } of verdict.problems) {
      metrics[problem] += 1;
      category[problem] += 1;
      failures.push({ file: label.file, category: label.category, problem, detail });
    }
  }

  return {
    set,
    total: corpus.length,
    ignoreMail: corpus.filter((label) => label.outcome === "ignore").length,
    requestMail: corpus.filter((label) => label.outcome !== "ignore").length,
    metrics,
    extra: {
      stored: rows.length,
      shownInReview: rows.filter((row) => !row.reviewed).length,
      needlessReview,
      heldForPerson,
      modelCalls: modelCalls(),
      downloadedIgnored,
      verdicts,
    },
    categories: [...perCategory.values()],
    failures,
  };
}

export { requestOf };
