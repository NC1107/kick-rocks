import type { KickRocksDb } from "@kickrocks/db";
import { messages, replyPredictions } from "@kickrocks/db";
import {
  PRECISION_TARGET,
  type ReplyClassification,
  type ReplyModelCheck,
  type ReplyModelStatus,
  type ReplyModelView,
  type ReplySuggestion,
  SPOT_CHECKS_NEEDED,
  wilsonInterval,
} from "@kickrocks/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import { encoderText, inputOf, inputSha256 } from "../mail/reply-model/input.js";
import { modelThreshold } from "../mail/thresholds.js";
import type { ClassificationResult } from "../mail/types.js";
import { type Clock, nowIso } from "./clock.js";
import type { Logger } from "./logger.js";
import type { SettingsStore } from "./settings.js";

/** Confidence bands the check reports acceptance in, from a coin flip up to the applied range. */
const BAND_EDGES = [0, 0.5, 0.7, 0.9, 0.96, 1.0001] as const;

interface Deps {
  db: KickRocksDb;
  clock: Clock;
  settings: SettingsStore;
  logger: Logger;
}

export interface ReplyPredictions {
  /** Writes the row for a message. Called inside the transaction that stores the message. */
  record(messageId: string, classified: ClassificationResult): void;
  /** Notes what a person decided and whether it matched the machine. Messages from before the table are left alone. */
  decide(messageId: string, personLabel: ReplyClassification): void;
  check(): ReplyModelCheck;
  view(status: ReplyModelStatus): ReplyModelView;
  /** Lets model answers be applied again, counting spot checks from now. */
  resume(): void;
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

export function createReplyPredictions({ db, clock, settings, logger }: Deps): ReplyPredictions {
  function stateFloor(): string | null {
    return settings.get("replyModel.state").countedFrom;
  }

  function check(): ReplyModelCheck {
    const floor = stateFloor();
    const decided = db
      .select()
      .from(replyPredictions)
      .where(isNotNull(replyPredictions.decidedAt))
      .all();
    const spots = decided.filter(
      (row) => row.spotCheck && (floor === null || (row.decidedAt ?? "") >= floor),
    );
    const agreed = spots.filter((row) => row.acceptedSuggestion === true).length;
    const interval = spots.length > 0 ? wilsonInterval(agreed, spots.length) : null;
    const bands = BAND_EDGES.slice(0, -1).map((from, index) => {
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
    return {
      spotChecks: spots.length,
      agreed,
      precision: spots.length > 0 ? agreed / spots.length : null,
      low: interval?.low ?? null,
      high: interval?.high ?? null,
      needed: SPOT_CHECKS_NEEDED,
      bands,
    };
  }

  /** Stops applying model answers when the spot checks rule out the precision they were chosen for. */
  function judge(): void {
    const state = settings.get("replyModel.state");
    if (state.pausedAt) return;
    const found = check();
    if (
      found.spotChecks < SPOT_CHECKS_NEEDED ||
      found.high === null ||
      found.high >= PRECISION_TARGET
    ) {
      return;
    }
    const reason = `Spot checks agreed with the reply model ${found.agreed} times out of ${found.spotChecks}, so its precision is probably below ${Math.round(PRECISION_TARGET * 100)}%`;
    settings.set("replyModel.state", { ...state, pausedAt: nowIso(clock), reason });
    logger.warn({ agreed: found.agreed, spotChecks: found.spotChecks }, "reply model paused");
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
      judge();
    },

    check,

    view(status) {
      const config = settings.get("replyModel");
      const state = settings.get("replyModel.state");
      return {
        status,
        threshold:
          status.state === "loaded" && status.threshold !== null
            ? modelThreshold(status.threshold, config.threshold)
            : null,
        thresholdOverride: config.threshold,
        spotCheckPercent: config.spotCheckPercent,
        paused:
          state.pausedAt && state.reason ? { at: state.pausedAt, reason: state.reason } : null,
        check: check(),
      };
    },

    resume() {
      settings.set("replyModel.state", {
        pausedAt: null,
        reason: null,
        countedFrom: nowIso(clock),
      });
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
