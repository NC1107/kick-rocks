import type { MatchRow, MessageRow } from "@kickrocks/db";
import type { Match, MessageDetail, MessageSummary } from "@kickrocks/shared";
import { WebUrl } from "@kickrocks/shared";

export function toMessageSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    requestId: row.requestId,
    fromAddress: row.fromAddress,
    subject: row.subject,
    receivedAt: row.receivedAt,
    classification: row.classification,
    confidence: row.confidence,
    rationale: row.rationale,
    links: row.links.filter((link) => WebUrl.safeParse(link).success),
    requestedFields: row.requestedFields,
    snippet: row.snippet,
    reviewed: row.reviewed,
  };
}

export function toMessageDetail(row: MessageRow): MessageDetail {
  return { ...toMessageSummary(row), text: row.text };
}

export function toMatch(row: MatchRow, targetName: string): Match {
  return {
    id: row.id,
    scanId: row.scanId,
    profileId: row.profileId,
    targetId: row.targetId,
    targetName,
    recordUrl: row.recordUrl,
    fields: row.fields,
    decision: row.decision,
    decidedAt: row.decidedAt,
    requestId: row.requestId,
  };
}
