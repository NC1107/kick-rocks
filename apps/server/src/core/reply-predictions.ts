import type { KickRocksDb } from "@kickrocks/db";
import { messages, replyPredictions } from "@kickrocks/db";
import type {
  ReplyClassification,
  ReplyModelStatus,
  ReplyModelView,
  ReplySuggestion,
} from "@kickrocks/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import { encoderText, inputOf, inputSha256 } from "../mail/reply-model/input.js";
import type { ClassificationResult } from "../mail/types.js";
import { type Clock, nowIso } from "./clock.js";

/** Confidence bands the check reports acceptance in, from a coin flip up to the applied range. */
const BAND_EDGES = [0, 0.5, 0.7, 0.9, 0.96, 1.0001] as const;

interface Deps {
  db: KickRocksDb;
  clock: Clock;
}

export interface ReplyPredictions {
  /** Writes the row for a message. Called inside the transaction that stores the message. */
  record(messageId: string, classified: ClassificationResult): void;
  /** Notes what a person decided and whether it matched the machine. Messages from before the table are left alone. */
  decide(messageId: string, personLabel: ReplyClassification): void;
  view(status: ReplyModelStatus): ReplyModelView;
  /** Every reply a person labelled whose text still matches what the model read, as JSON lines. */
  exportLabels(): string;
}

type Row = typeof replyPredictions.$inferSelect;

/**
 * What Review starts from for a message. A spot check is returned flagged so the page can leave
 * it unanswered, and a rules guess only counts when it says something.
 */
export function suggestionOf(row: Row | null | undefined): ReplySuggestion | null {
  if (!row || row.autoApplied) return null;
  if (row.modelLabel && row.modelConfidence !== null) {
    return {
      classification: row.modelLabel,
      confidence: row.modelConfidence,
      source: row.source === "llm" ? "llm" : "model",
      spotCheck: row.spotCheck,
    };
  }
  if (row.rulesLabel === "unknown") return null;
  return {
    classification: row.rulesLabel,
    confidence: row.rulesConfidence,
    source: "rules",
    spotCheck: false,
  };
}

/** What the machine said, to compare with the person: the model's guess when it made one, else the rules'. */
function machineLabel(row: Row): ReplyClassification | null {
  if (row.modelLabel) return row.modelLabel;
  return row.rulesLabel === "unknown" && !row.autoApplied ? null : row.rulesLabel;
}

export function createReplyPredictions({ db, clock }: Deps): ReplyPredictions {
  function bands(): ReplyModelView["bands"] {
    const decided = db
      .select()
      .from(replyPredictions)
      .where(isNotNull(replyPredictions.decidedAt))
      .all();
    return BAND_EDGES.slice(0, -1).map((from, index) => {
      const to = BAND_EDGES[index + 1] as number;
      // Only answers a person was asked about count. A correction of an applied answer exists only
      // when it was wrong, and the language model's confidence is not the reply model's.
      const inBand = decided.filter(
        (row) =>
          row.source === "model" &&
          !row.autoApplied &&
          row.modelConfidence !== null &&
          row.modelConfidence >= from &&
          row.modelConfidence < to,
      );
      return {
        from,
        to: Math.min(to, 1),
        answers: inBand.length,
        accepted: inBand.filter((row) => row.acceptedSuggestion === true).length,
      };
    });
  }

  return {
    record(messageId, classified) {
      const { prediction, suggestion } = classified;
      // A model answer the classifier threw out leaves no guess behind, or Review would rebuild
      // the suggestion the classifier had decided against.
      const standsBehindGuess =
        classified.source !== "rules" && (classified.apply || suggestion !== null);
      const guess =
        classified.source === "llm" && suggestion
          ? { label: suggestion.classification, confidence: suggestion.confidence }
          : prediction.model
            ? { label: prediction.model.label, confidence: prediction.model.confidence }
            : null;
      db.insert(replyPredictions)
        .values({
          messageId,
          source: classified.source,
          modelVersion: prediction.model?.version ?? null,
          modelLabel: standsBehindGuess ? (guess?.label ?? null) : null,
          modelConfidence: standsBehindGuess ? (guess?.confidence ?? null) : null,
          probabilities: prediction.model?.probabilities ?? null,
          rulesLabel: prediction.rules.label,
          rulesConfidence: prediction.rules.confidence,
          inputSha256: prediction.inputSha256,
          autoApplied: classified.apply,
          spotCheck: suggestion?.spotCheck ?? false,
          personLabel: null,
          acceptedSuggestion: null,
          decidedAt: null,
          createdAt: nowIso(clock),
        })
        .run();
    },

    decide(messageId, personLabel) {
      const row = db
        .select()
        .from(replyPredictions)
        .where(eq(replyPredictions.messageId, messageId))
        .get();
      if (!row) return;
      const said = machineLabel(row);
      db.update(replyPredictions)
        .set({
          personLabel,
          acceptedSuggestion: said === null ? null : said === personLabel,
          decidedAt: nowIso(clock),
        })
        .where(eq(replyPredictions.messageId, messageId))
        .run();
    },

    view(status) {
      return { status, bands: bands() };
    },

    exportLabels() {
      const rows = db
        .select({ prediction: replyPredictions, subject: messages.subject, text: messages.text })
        .from(replyPredictions)
        .innerJoin(messages, eq(messages.id, replyPredictions.messageId))
        .where(and(isNotNull(replyPredictions.personLabel), isNotNull(messages.text)))
        .all();
      const lines: string[] = [];
      for (const { prediction, subject, text } of rows) {
        const input = inputOf({ subject, text: text ?? "" });
        if (prediction.inputSha256 !== inputSha256(input)) continue;
        lines.push(
          JSON.stringify({
            text: encoderText(input),
            label: prediction.personLabel,
            source: prediction.source,
            modelLabel: prediction.modelLabel,
            modelConfidence: prediction.modelConfidence,
            spotCheck: prediction.spotCheck,
            decidedAt: prediction.decidedAt,
          }),
        );
      }
      return lines.length > 0 ? `${lines.join("\n")}\n` : "";
    },
  };
}
