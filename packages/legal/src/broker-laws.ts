import { StateCode, WebUrl } from "@kickrocks/shared";
import { z } from "zod";

/**
 * A data broker registration law. These make a broker register and publish how a consumer can opt
 * out, but give the consumer no right to demand anything, so they are never the basis of a
 * request. They are kept so the app can say which states register brokers.
 */
export const BrokerRegistrationLaw = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  state: StateCode,
  name: z.string().min(1),
  citation: z.string().min(1),
  effectiveDate: z.iso.date(),
  summary: z.string().min(1),
  sourceUrl: WebUrl,
});
export type BrokerRegistrationLaw = z.infer<typeof BrokerRegistrationLaw>;

export const BROKER_REGISTRATION_LAWS: readonly BrokerRegistrationLaw[] = [
  {
    id: "vt-data-broker-registration",
    state: "VT",
    name: "Vermont data broker registration",
    citation: "9 V.S.A. 2430, 2446, 2447",
    effectiveDate: "2019-01-01",
    summary:
      "Brokers register each year and must say whether a consumer can opt out of collection, databases, or sales, and how. Act 138 of 2026 raises the fee to 900 dollars and adds a 20,000 dollar bond from 2027-01-01. It drops the proposed consumer deletion right and orders a feasibility study of a deletion mechanism instead.",
    sourceUrl: "https://legislature.vermont.gov/statutes/section/09/062/02446",
  },
  {
    id: "tx-data-broker-registration",
    state: "TX",
    name: "Texas data broker registration",
    citation: "Tex. Bus. & Com. Code ch. 509",
    effectiveDate: "2023-09-01",
    summary:
      "Brokers register each year with the Secretary of State and post a notice on their website. The chapter gives consumers no request right.",
    sourceUrl: "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.509.htm",
  },
  {
    id: "or-data-broker-registration",
    state: "OR",
    name: "Oregon data broker registration",
    citation: "Or. Rev. Stat. 646A.593",
    effectiveDate: "2024-01-01",
    summary:
      "Brokers register with the Department of Consumer and Business Services and must say whether and how a resident can opt out. The section gives consumers no request right.",
    sourceUrl: "https://www.oregonlegislature.gov/bills_laws/ors/ors646A.html",
  },
];
