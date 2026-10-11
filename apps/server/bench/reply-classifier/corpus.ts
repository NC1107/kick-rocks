import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplyClassification } from "@kickrocks/shared";
import { parseInboxMessage } from "../../src/mail/parse.js";
import { stripQuoted } from "../../src/mail/reply-text.js";
import { LIVE_SHAPE_DEV_CASES, LIVE_SHAPE_HELDOUT_CASES } from "./data/live-shape.js";
import { DEV_EXTRA_REPLY_CASES } from "./data/tuning/dev-replies.js";
import { HELDOUT_REPLY_CASES } from "./data/tuning/heldout-replies.js";
import { REPLY_CASES, type ReplyCase } from "./data/tuning/reply-cases.js";
import { isLabel } from "./labels.js";
import type { Item, Source, Split } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const INTAKE_DIR = join(here, "..", "..", "fixtures", "mail-intake");
const TUNING_SENDER = "privacy@broker.example";

interface IntakeLabel {
  file: string;
  classification: string | null;
}

function fromCase(reply: ReplyCase, split: Split): Item {
  return {
    id: `tuning:${reply.id}`,
    source: "tuning",
    split,
    truth: reply.truth,
    subject: reply.subject,
    body: stripQuoted(reply.body),
    fromAddress: TUNING_SENDER,
    raw: null,
  };
}

/** The labeled replies written for tuning, each split kept as the branch that wrote them kept it. */
export function tuningItems(split: Split): Item[] {
  const cases =
    split === "dev"
      ? [...REPLY_CASES, ...DEV_EXTRA_REPLY_CASES, ...LIVE_SHAPE_DEV_CASES]
      : [...HELDOUT_REPLY_CASES, ...LIVE_SHAPE_HELDOUT_CASES];
  return cases.map((reply) => fromCase(reply, split));
}

/** Mail that is no reply to a request has no classification in the corpus, which means unrelated. */
function intakeTruth(label: IntakeLabel): ReplyClassification {
  if (label.classification === null) return "unrelated";
  if (!isLabel(label.classification)) {
    throw new Error(`${label.file} has the unknown classification "${label.classification}"`);
  }
  return label.classification;
}

export async function intakeItems(split: Split): Promise<Item[]> {
  const folder = join(INTAKE_DIR, split === "dev" ? "dev" : "held-out");
  const labels = JSON.parse(readFileSync(join(folder, "labels.json"), "utf8")) as IntakeLabel[];
  const files = new Set(readdirSync(folder).filter((name) => name.endsWith(".eml")));
  const items: Item[] = [];
  for (const label of labels) {
    if (!files.has(label.file)) throw new Error(`${folder} has no file ${label.file}`);
    const source = readFileSync(join(folder, label.file));
    const message = await parseInboxMessage({ uid: items.length + 1, source });
    items.push({
      id: `intake:${split}/${label.file}`,
      source: "intake",
      split,
      truth: intakeTruth(label),
      subject: message.subject,
      body: stripQuoted(message.text),
      fromAddress: message.from.address,
      raw: source.toString("utf8"),
    });
  }
  return items;
}

export async function loadItems(split: Split, sources: readonly Source[]): Promise<Item[]> {
  const items: Item[] = [];
  if (sources.includes("tuning")) items.push(...tuningItems(split));
  if (sources.includes("intake")) items.push(...(await intakeItems(split)));
  return items;
}

/** Ids of held-out items whose subject and body appear unchanged in dev, which would flatter a model trained on dev. */
export function duplicatesAcross(dev: readonly Item[], heldout: readonly Item[]): string[] {
  const seen = new Set(dev.map((item) => `${item.subject}\n${item.body}`));
  return heldout.filter((item) => seen.has(`${item.subject}\n${item.body}`)).map((item) => item.id);
}
