/** Hosts of the human checks a form may embed, which the detector in the recipe runner names too. */
const CHALLENGE_HOSTS: readonly { host: RegExp; path?: RegExp }[] = [
  { host: /^(www\.)?google\.com$/, path: /^\/recaptcha\// },
  { host: /^(www\.)?gstatic\.com$/, path: /^\/recaptcha\// },
  { host: /^(www\.)?recaptcha\.net$/ },
  { host: /(^|\.)hcaptcha\.com$/ },
  { host: /^challenges\.cloudflare\.com$/ },
];

export function isChallengeHost(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return CHALLENGE_HOSTS.some(
      (entry) =>
        entry.host.test(hostname) && (entry.path === undefined || entry.path.test(pathname)),
    );
  } catch {
    return false;
  }
}

export type Rule = "R1" | "R1-third" | "R1-lookup" | "R2" | "R2-challenge" | "R3" | "U" | "pass";

export type Verdict =
  | { action: "continue"; rule: Rule }
  | { action: "lookup"; rule: Rule }
  | { action: "send"; rule: Rule }
  | { action: "refuse"; rule: Rule; reason: string };

export interface Facts {
  party: "target" | "third";
  method: string;
  /** The request has a body, whether or not it could be read. */
  hasBody: boolean;
  /** The request could not be read in full. */
  unreadable: boolean;
  carriesContact: boolean;
  carriesLookup: boolean;
  touched: boolean;
  challengeHost: boolean;
}

/**
 * Decides what to do with one outgoing request, from the rules of the gate and nothing else.
 * Nothing here looks at which control a model clicked or when, so no timing can get past it.
 */
export function decide(facts: Facts): Verdict {
  const carriesSomething = facts.carriesContact || facts.carriesLookup;
  if (facts.party === "third") {
    if (carriesSomething) {
      return { action: "refuse", rule: "R1-third", reason: "third_party_value" };
    }
    if (facts.touched && !facts.challengeHost) {
      return { action: "refuse", rule: "R3", reason: "third_party_after_touch" };
    }
    return { action: "continue", rule: facts.touched && facts.hasBody ? "R2-challenge" : "pass" };
  }
  // What a person cannot read in full they cannot approve, so it is never held.
  if (facts.hasBody && facts.unreadable && (facts.carriesContact || facts.touched)) {
    return { action: "refuse", rule: "U", reason: "unreadable_body" };
  }
  if (facts.carriesContact) return { action: "send", rule: "R1" };
  if (facts.touched && facts.hasBody) return { action: "send", rule: "R2" };
  if (facts.carriesLookup) {
    const method = facts.method.toUpperCase();
    return { action: "lookup", rule: method === "GET" || method === "HEAD" ? "R1-lookup" : "pass" };
  }
  return { action: "continue", rule: "pass" };
}
