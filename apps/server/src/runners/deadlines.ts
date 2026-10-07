import { profiles } from "@kickrocks/db";
import { POLICY_RESPONSE_DAYS, type RequestRecord } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import type { AppServices } from "../services.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResponseWindow {
  /** When the broker's answer is due under the legal basis the request cited. */
  dueAt: string;
  /** When silence is worth a follow-up: the due date, or the person's own wait if that is longer. */
  followUpAt: string;
}

/**
 * The two deadlines every send sets. The statute (or the policy default) says when an answer is
 * owed, and the person's `noResponseDays` can only make the wait longer, because nudging a broker
 * before the law requires it to answer would just be noise.
 */
export function responseWindow(
  services: Pick<AppServices, "db" | "legal" | "settings">,
  request: Pick<RequestRecord, "profileId" | "legalBasis" | "rights">,
  sentAt: Date,
): ResponseWindow {
  const profile = services.db
    .select({ state: profiles.state })
    .from(profiles)
    .where(eq(profiles.id, request.profileId))
    .get();
  const responseDays =
    (profile
      ? services.legal.getLegalBasis(request.legalBasis, profile.state, request.rights)
      : null
    )?.responseDays ?? POLICY_RESPONSE_DAYS;
  const waitDays = Math.max(responseDays, services.settings.get("schedule").noResponseDays);
  return {
    dueAt: new Date(sentAt.getTime() + responseDays * DAY_MS).toISOString(),
    followUpAt: new Date(sentAt.getTime() + waitDays * DAY_MS).toISOString(),
  };
}
