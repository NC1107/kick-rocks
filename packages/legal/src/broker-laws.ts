import { StateCode, WebUrl } from "@kickrocks/shared";
import { z } from "zod";

/**
 * A data broker registration law. These make a broker register and publish how a consumer can opt
 * out, but give the consumer no right to demand anything by email, so they are never the basis of
 * a request. Connecticut's also creates a state deletion mechanism, which does not exist yet. They
 * are kept so the app can say which states register brokers.
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
      "Brokers register each year with the Secretary of State and post a notice on their website. The chapter gives consumers no request right. Since 2025-09-01 (SB 1343 and SB 2121, signed 2025-06-20) the notice must inform a consumer how to exercise any rights under Chapter 541, the registration must link to a page on how to exercise rights under Section 541.051, and a data broker is any entity that collects, processes, or transfers personal data it did not collect directly from the individual. The limits in 509.003(a) remain: more than 50 percent of revenue, or revenue from the data of more than 50,000 individuals.",
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
  {
    id: "nj-data-broker-registration",
    state: "NJ",
    name: "New Jersey data broker and data collector registration",
    citation: "P.L. 2026, c. 25 (N.J.S.A. 56:8-166.20 to 56:8-166.24)",
    effectiveDate: "2026-06-30",
    summary:
      "Brokers and data collectors, meaning businesses with a direct consumer relationship that sell or license personal data to a broker, register each year and may not sell or license sensitive data. The act (A5328) was approved on 2026-06-30 and took effect immediately, except that the public registry stays inoperative for 270 days after enactment, which is 2027-03-27. The registry lists each broker's opt-out information. It is a registration and conduct law, so it gives consumers no request right. The comprehensive Data Privacy Act (P.L. 2023, c. 266) is the separate source of New Jersey consumer rights.",
    sourceUrl: "https://pub.njleg.state.nj.us/Bills/2026/PL26/25_.PDF",
  },
  {
    id: "ct-data-broker-registration",
    state: "CT",
    name: "Connecticut data broker registration and deletion mechanism",
    citation: "Conn. P.A. 26-64 secs. 1-10, as amended by P.A. 26-100 secs. 39-43",
    effectiveDate: "2026-10-01",
    summary:
      "From 2027-01-01 no data broker may sell or license brokered personal data unless registered (sec. 2, fee 2,500 dollars). The Commissioner must build an accessible deletion mechanism by 2028-07-01 (sec. 5(a)), and from 2028-10-01 each registered broker must access it at least once every forty-five days (sec. 5(c)). Like California's Delete Act this gives consumers a deletion route through a state platform, so it is not a registration law with no right, but the mechanism does not exist yet and no deadline for answering is encoded here. Until it does, no request is based on it.",
    sourceUrl: "https://www.cga.ct.gov/2026/ACT/PA/PDF/2026PA-00064-R00SB-00004-PA.PDF",
  },
];
