import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type TargetRow, targets } from "@kickrocks/db";
import { loadRecipes } from "@kickrocks/recipes";
import {
  needsRecord,
  type RequestRight,
  ScanningSettings,
  type StateCode,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { openAppDatabase } from "../app.js";
import { loadConfig } from "../config.js";
import { createCampaignPlanner, type Plan } from "../modules/campaigns/planner.js";
import { syncRecipes } from "../modules/recipes/sync.js";
import { createServices } from "../services.js";
import { FakeClock } from "./clock.js";
import { FakeAuth } from "./fake-auth.js";
import { createFakeMail } from "./fake-mail.js";
import { seedMailbox, seedProfile } from "./seed.js";

/** One of the ways the dataset and the planner can disagree with the evidence kept beside them. */
export type CheckName = "flag_vs_recipe" | "email_evidence" | "scan_not_planned" | "owner_group";

export interface Contradiction {
  check: CheckName;
  id: string;
  detail: string;
}

export interface JudgmentCall {
  check: CheckName;
  id: string;
  reason: string;
}

export type Bucket = "email" | "form" | "scan" | "skipped";

export interface ProfileShare {
  state: StateCode;
  mailbox: boolean;
  total: number;
  counts: Record<Bucket, number>;
  /** Percent of the campaign in each bucket, one decimal. */
  percent: Record<Bucket, number>;
  skipReasons: Record<string, number>;
}

export interface CoverageResult {
  score: number;
  targetMet: boolean;
  contradictions: Contradiction[];
  judgmentCalls: (JudgmentCall & { matched: boolean })[];
  byCheck: Record<CheckName, number>;
  planner: Record<"non_california" | "california" | "no_mailbox", ProfileShare>;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const JUDGMENT_FILE = join(REPO_ROOT, "scripts", "loops", "coverage", "judgment-calls.json");

/** Deletion only, because that is the one right for which California sends a registered broker to DROP. */
const RIGHTS: RequestRight[] = ["delete"];

/** Flags a recipe can disprove, because they say the site cannot be finished online. */
const OFFLINE_FLAGS = ["paid", "phone_call", "fax", "postal_mail"] as const;

const BOUNCE = /\b(hard-)?bounced\b/i;
const TRANSIENT = /mailbox full|transient|retry/i;
/** Replies about device ids say the request cannot be matched, which no channel fixes. */
const IDENTIFIER_ONLY = /\b(MAID|advertising ID|identifiers?)\b/i;
const MAIL_WORD = "(e-?mail|mailbox|inbox)";
/** A reply or note that says the broker does not act on mail, or wants the form instead. */
const FORM_ONLY_REPLY = [
  new RegExp(
    `${MAIL_WORD}[^.]{0,60}(not (processed|accepted|monitored)|isn.t monitored|unmonitored|aren.t accepted)`,
    "i",
  ),
  new RegExp(
    `(not (accept|process)(ed)?|doesn.t process|do(es)? not (accept|process)|(unable to|cannot|can.t|not able to) (accept|process))[^.]{0,60}(via|by|through|over) ${MAIL_WORD}`,
    "i",
  ),
  /\b(web ?form|portal|form|online form) only\b/i,
  /\bnot (by |via |through )?e-?mail\b/i,
  /\binstead of e-?mail\b/i,
  /\bmust go through\b[^.]{0,60}\b(form|portal)\b/i,
  /\bonly (submission )?(method|path|way|option)\b|\bonly go(es)? through\b|\bdesignated method\b/i,
  /\b(direct|point|refer|redirect|route)(s|ed)?\b[^.]{0,80}\b(form|portal|webform|privacy center|dsar)\b/i,
  new RegExp(`${MAIL_WORD} requests require`, "i"),
  /\bdoes not respond to\b|\bno longer evaluate requests\b/i,
];
const SAYS_USE_FORM =
  /\b(use|via|through|go to|complete|fill)\b.{0,60}\b(form|portal|opt_out_url|web form)\b/i;
const NAMES_OTHER_ADDRESS =
  /\b(corrected to|updated to|is the address|found [^ ]+@|current one|now live|no longer in use|pointed to [^ ]+@|worth retrying)\b/i;

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const sentencesOf = (notes: string): string[] =>
  notes
    .split(/(?<=\.)\s+| \| /)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

function bucketOf(plan: Plan): Bucket {
  if (plan.kind === "scan") return "scan";
  if (plan.kind === "skip") return "skipped";
  return plan.channel;
}

function seedFixedProfile(
  services: ReturnType<typeof createServices>,
  state: StateCode,
  withMailbox: boolean,
): string {
  const seeder = { services };
  const profile = seedProfile(seeder, { state });
  if (withMailbox) seedMailbox(seeder, profile.id);
  return profile.id;
}

interface PlannerWorld {
  plansFor: (state: StateCode, mailbox: boolean) => Plan[];
  rows: TargetRow[];
  close: () => void;
}

/**
 * The real planner over the real dataset, bundled recipes as shipped (only the verified ones are
 * active), the real statutes and an unpaced clock. It never opens a socket and never writes outside
 * a throwaway data directory.
 */
function openPlannerWorld(): PlannerWorld {
  const dir = mkdtempSync(join(tmpdir(), "kickrocks-coverage-"));
  const config = loadConfig({
    KICKROCKS_DATA_DIR: dir,
    KICKROCKS_PUBLIC_URL: "http://kickrocks.test",
    KICKROCKS_WORKER_TOKEN: "coverage-worker-token-0123456789",
    KICKROCKS_SCHEDULER: "off",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  });
  const clock = new FakeClock("2026-10-07T12:00:00.000Z");
  const database = openAppDatabase(config);
  const services = createServices(config, database.db, {
    clock,
    mail: createFakeMail(clock).services,
    auth: new FakeAuth(),
    passwordCost: { timeCost: 1, memoryCost: 1024, parallelism: 1 },
  });
  services.settings.set("scanning", ScanningSettings.parse({}));
  services.targets.sync();
  syncRecipes(services);

  const planner = createCampaignPlanner({
    db: services.db,
    clock: services.clock,
    legal: services.legal,
    targets: services.targets,
    taskQueue: services.taskQueue,
    needsRecord: services.dispatch.needsRecord,
  });
  return {
    plansFor(state, mailbox) {
      const profileId = seedFixedProfile(services, state, mailbox);
      return planner.plan(profileId, { preset: "everything" }, RIGHTS).plans;
    },
    rows: services.db.select().from(targets).where(eq(targets.retired, false)).all(),
    close() {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function shareOf(state: StateCode, mailbox: boolean, plans: Plan[]): ProfileShare {
  const counts: Record<Bucket, number> = { email: 0, form: 0, scan: 0, skipped: 0 };
  const skipReasons: Record<string, number> = {};
  for (const plan of plans) {
    counts[bucketOf(plan)] += 1;
    if (plan.kind === "skip") skipReasons[plan.reason] = (skipReasons[plan.reason] ?? 0) + 1;
  }
  const total = plans.length;
  const percent = Object.fromEntries(
    (Object.keys(counts) as Bucket[]).map((bucket) => [
      bucket,
      Math.round((counts[bucket] / total) * 1000) / 10,
    ]),
  ) as Record<Bucket, number>;
  return { state, mailbox, total, counts, percent, skipReasons };
}

interface RecipeSummary {
  brokerId: string;
  purpose: "scan" | "remove";
  alsoFor: string[];
  verified: boolean;
}

function bundledRecipes(): RecipeSummary[] {
  return loadRecipes().recipes.map(({ recipe }) => ({
    brokerId: recipe.brokerId,
    purpose: recipe.purpose,
    alsoFor: recipe.alsoFor,
    verified: recipe.liveStatus === "verified",
  }));
}

function flagContradictions(rows: TargetRow[], recipes: RecipeSummary[]): Contradiction[] {
  const removers = new Set(
    recipes
      .filter((r) => r.purpose === "remove" && r.verified)
      .flatMap((r) => [r.brokerId, ...r.alsoFor]),
  );
  return rows.flatMap((row) => {
    if (!removers.has(row.id)) return [];
    return OFFLINE_FLAGS.filter((flag) => row.requirements.includes(flag)).map((flag) => ({
      check: "flag_vs_recipe" as const,
      id: row.id,
      detail: `${flag} is flagged but a verified remove recipe finishes the site without it`,
    }));
  });
}

/** Whether a bounce sentence is about the address the planner would still send to. */
function bounceHitsCurrentAddress(sentence: string, current: string): boolean {
  if (!BOUNCE.test(sentence) || NAMES_OTHER_ADDRESS.test(sentence) || TRANSIENT.test(sentence)) {
    return false;
  }
  const bounceAt = sentence.search(BOUNCE);
  const named = [...sentence.matchAll(EMAIL_IN_TEXT)].map((m) => ({
    address: m[0].toLowerCase(),
    at: m.index ?? 0,
  }));
  const bounced = named.filter((m) => m.at < bounceAt).at(-1) ?? named[0];
  if (bounced) return bounced.address === current.toLowerCase();
  return SAYS_USE_FORM.test(sentence) || /no working email/i.test(sentence);
}

function replyHitsEmail(sentence: string): boolean {
  if (
    NAMES_OTHER_ADDRESS.test(sentence) ||
    TRANSIENT.test(sentence) ||
    IDENTIFIER_ONLY.test(sentence)
  ) {
    return false;
  }
  return FORM_ONLY_REPLY.some((pattern) => pattern.test(sentence));
}

function emailContradictions(rows: TargetRow[], plans: Plan[]): Contradiction[] {
  const emailed = new Set(
    plans.flatMap((plan) =>
      plan.kind === "request" && plan.channel === "email" ? [plan.target.id] : [],
    ),
  );
  return rows.flatMap((row) => {
    const notes = row.data.notes;
    if (!emailed.has(row.id) || !notes || row.privacyEmail === null || row.optOutUrl === null) {
      return [];
    }
    const hit = sentencesOf(notes).find(
      (sentence) =>
        bounceHitsCurrentAddress(sentence, row.privacyEmail as string) || replyHitsEmail(sentence),
    );
    return hit ? [{ check: "email_evidence" as const, id: row.id, detail: hit.slice(0, 200) }] : [];
  });
}

function scanContradictions(
  rows: TargetRow[],
  plans: Plan[],
  recipes: RecipeSummary[],
): Contradiction[] {
  const bucketById = new Map(plans.map((plan) => [plan.target.id, plan] as const));
  const scanned = new Set(
    recipes.filter((r) => r.purpose === "scan").flatMap((r) => [r.brokerId, ...r.alsoFor]),
  );
  return rows.flatMap((row) => {
    if (!scanned.has(row.id)) return [];
    const plan = bucketById.get(row.id);
    if (!plan || plan.kind === "scan") return [];
    const how = plan.kind === "skip" ? `skipped as ${plan.reason}` : `planned as ${plan.channel}`;
    return [
      {
        check: "scan_not_planned" as const,
        id: row.id,
        detail: `a scan recipe exists but the planner ${how}`,
      },
    ];
  });
}

function ownerGroupContradictions(rows: TargetRow[], plans: Plan[]): Contradiction[] {
  const planById = new Map(plans.map((plan) => [plan.target.id, plan] as const));
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const owner = "ownerGroup" in row.data ? row.data.ownerGroup : undefined;
    if (owner) groups.set(owner, [...(groups.get(owner) ?? []), row]);
  }
  const found: Contradiction[] = [];
  for (const [owner, members] of groups) {
    const byCategory = new Map<string, TargetRow[]>();
    for (const member of members) {
      byCategory.set(member.category, [...(byCategory.get(member.category) ?? []), member]);
    }
    for (const [category, peers] of byCategory) {
      const buckets = peers.map((peer) => bucketOf(planById.get(peer.id) as Plan));
      const tally = new Map<Bucket, number>();
      for (const bucket of buckets) tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
      if (tally.size < 2) continue;
      const [majority] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] as [Bucket, number];
      for (const peer of peers) {
        const bucket = bucketOf(planById.get(peer.id) as Plan);
        if (bucket !== majority) {
          found.push({
            check: "owner_group",
            id: peer.id,
            detail: `${owner} ${category} peers are planned as ${majority}, this one as ${bucket}`,
          });
        }
      }
    }
    const categoryCounts = new Map<string, number>();
    for (const member of members) {
      categoryCounts.set(member.category, (categoryCounts.get(member.category) ?? 0) + 1);
    }
    const [topCategory] = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0] as [
      string,
      number,
    ];
    for (const member of members) {
      const sameRoute =
        needsRecord({ id: member.id, category: member.category }) ===
        needsRecord({ id: member.id, category: topCategory as TargetRow["category"] });
      if (member.category !== topCategory && !sameRoute) {
        found.push({
          check: "owner_group",
          id: member.id,
          detail: `${owner} is mostly ${topCategory}, this member is filed as ${member.category}`,
        });
      }
    }
  }
  return found;
}

export function readJudgmentCalls(): JudgmentCall[] {
  return JSON.parse(readFileSync(JUDGMENT_FILE, "utf8")) as JudgmentCall[];
}

/** Everything the loop counts, with judgment calls set apart so they stay visible but do not score. */
export function measureCoverage(): CoverageResult {
  const world = openPlannerWorld();
  try {
    const nonCa = world.plansFor("TX", true);
    const ca = world.plansFor("CA", true);
    const noMailbox = world.plansFor("TX", false);
    const recipes = bundledRecipes();
    const all = [
      ...flagContradictions(world.rows, recipes),
      ...emailContradictions(world.rows, nonCa),
      ...scanContradictions(world.rows, nonCa, recipes),
      ...ownerGroupContradictions(world.rows, nonCa),
    ];
    const calls = readJudgmentCalls();
    const key = (item: { check: string; id: string }) => `${item.check}:${item.id}`;
    const judged = new Set(calls.map(key));
    const open = all.filter((item) => !judged.has(key(item)));
    const found = new Set(all.map(key));
    const byCheck: Record<CheckName, number> = {
      flag_vs_recipe: 0,
      email_evidence: 0,
      scan_not_planned: 0,
      owner_group: 0,
    };
    for (const item of open) byCheck[item.check] += 1;
    return {
      score: open.length,
      targetMet: open.length === 0,
      contradictions: open,
      judgmentCalls: calls.map((call) => ({ ...call, matched: found.has(key(call)) })),
      byCheck,
      planner: {
        non_california: shareOf("TX", true, nonCa),
        california: shareOf("CA", true, ca),
        no_mailbox: shareOf("TX", false, noMailbox),
      },
    };
  } finally {
    world.close();
  }
}
