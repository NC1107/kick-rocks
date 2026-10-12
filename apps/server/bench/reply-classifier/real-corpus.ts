import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplyClassification } from "@kickrocks/shared";
import { isLabel } from "./labels.js";

/** One real reply with its ground truth, as the collection agents saved it. */
export interface RealReply {
  /** The file under the corpus folder, which is the reply's identity. */
  id: string;
  company: string;
  source: string;
  truth: ReplyClassification;
  subject: string;
  body: string;
  /** The sender when the source shows one. */
  fromAddress: string | null;
}

interface LabelEntry {
  file: string;
  company: string | null;
  source: string;
  classification: string | null;
  ambiguous: boolean;
}

interface ReplyFile {
  subject: string | null;
  text: string;
  from: string | null;
}

/** "Name <a@b.c>" or a bare address; anything else is no sender. */
export function addressOf(from: string | null): string | null {
  const match = from?.match(/[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/);
  return match ? match[0].toLowerCase() : null;
}

/** Reads `labels.json` and the reply files next to it. Ambiguous entries have no single truth and are left out. */
export function loadRealReplies(dir: string): RealReply[] {
  const labels = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")) as {
    replies: LabelEntry[];
  };
  const replies: RealReply[] = [];
  for (const entry of labels.replies) {
    if (entry.ambiguous || entry.classification === null) continue;
    if (!isLabel(entry.classification)) {
      throw new Error(`${entry.file} has the unknown classification "${entry.classification}"`);
    }
    const file = JSON.parse(readFileSync(join(dir, entry.file), "utf8")) as ReplyFile;
    replies.push({
      id: entry.file,
      company: entry.company ?? "Unnamed company",
      source: entry.source,
      truth: entry.classification,
      subject: file.subject ?? "",
      body: file.text,
      fromAddress: addressOf(file.from),
    });
  }
  return replies;
}

/** Each distinct source once, in order, which is what is committed in place of the replies. */
export function sourceUrls(replies: readonly RealReply[]): string[] {
  return [...new Set(replies.map((reply) => reply.source))].sort();
}
