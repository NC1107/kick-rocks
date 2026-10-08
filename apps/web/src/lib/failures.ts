import { ProfileField } from "@kickrocks/shared";
import { PROFILE_FIELD_LABELS } from "./labels.js";

const FIELD_NAMES = new RegExp(`\\b(${ProfileField.options.join("|")})\\b`, "g");

/** Swaps internal field names such as date_of_birth for the words the profile page uses. */
export function plainError(text: string): string {
  return text.replace(FIELD_NAMES, (name) =>
    PROFILE_FIELD_LABELS[name as ProfileField].toLowerCase(),
  );
}

export type FailureGroup = "profile" | "network" | "recipe" | "site" | "internal";

interface FailureView {
  group: FailureGroup;
  /** The short label for the badge and for bulk actions. */
  label: string;
  /** What a person reads: the cause in plain words. */
  detail: string;
  /** The failure is a missing detail on the profile, which the person fixes there. */
  needsProfile: boolean;
}

const MISSING_DETAIL = /^(This site needs .+? on the profile)\./;
const BROWSER_ADDRESS = /net::ERR_[A-Z_]+ at (https?:\/\/[^\s/]+)/;
const TIMEOUT = /^(?:page|locator)\.[A-Za-z]+: Timeout \d+ms exceeded/;

const hostOf = (origin: string) => origin.replace(/^https?:\/\/(www\.)?/, "");

/** Turns what a worker reported into words for a person, and sorts it so like failures can be handled together. */
export function describeFailure(task: {
  lastError: string | null;
  failureKind: "recipe" | "site" | "network" | "internal" | null;
}): FailureView {
  const error = task.lastError ?? "";
  const missing = MISSING_DETAIL.exec(error);
  if (missing) {
    return {
      group: "profile",
      label: "Profile is missing a detail",
      detail: `${missing[1]}.`,
      needsProfile: true,
    };
  }
  const address = BROWSER_ADDRESS.exec(error);
  if (address) {
    return {
      group: "network",
      label: "Could not reach the site",
      detail: `Could not reach ${hostOf(address[1] as string)}. Check the connection, then retry.`,
      needsProfile: false,
    };
  }
  if (TIMEOUT.test(error)) {
    return {
      group: "network",
      label: "The site took too long",
      detail: "The site took too long to answer. Retry it later.",
      needsProfile: false,
    };
  }
  const group: FailureGroup = task.failureKind ?? "internal";
  return { group, label: GROUP_LABELS[group], detail: plainError(error), needsProfile: false };
}

export const GROUP_LABELS: Record<FailureGroup, string> = {
  profile: "Profile is missing a detail",
  network: "The connection dropped",
  recipe: "The saved steps no longer match the page",
  site: "The site had a problem",
  internal: "Something went wrong here",
};
