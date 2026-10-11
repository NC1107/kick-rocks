import { afterEach, beforeEach } from "vitest";
import { PROVEN_RULES, type RuleId } from "../mail/reply-rules.js";

/**
 * Puts rules on the proven list for the tests in the enclosing describe. The shipped list is
 * empty until fresh mail measures a rule, so the paths that move a request on a rule's word,
 * such as the sender trust caps, can only be exercised with one on it.
 */
export function withProvenRules(...ids: RuleId[]): void {
  const list = PROVEN_RULES as Set<RuleId>;
  beforeEach(() => {
    for (const id of ids) list.add(id);
  });
  afterEach(() => {
    for (const id of ids) list.delete(id);
  });
}
