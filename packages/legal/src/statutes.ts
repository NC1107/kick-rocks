import type { RequestRight, Statute } from "@kickrocks/shared";

/**
 * How a statute is used beyond what the shared schema records.
 * `deleteScope` is "provided" where the deletion right reaches only data the consumer gave the
 * business, which a data broker never received from the consumer.
 * `citable` is false for a law whose coverage is too narrow to claim for a business whose size is
 * unknown to this tool.
 */
interface StatuteTraits {
  deleteScope: "all" | "provided";
  citable: boolean;
  /**
   * The provision, read from its enacted text, that says an opt-out of sale need not be
   * authenticated. Null where none was found, and then the email claims nothing about proof of
   * identity and only asks politely not to be asked for ID, an account, or a fee.
   */
  optOutAuthRule: string | null;
  /**
   * A shorter deadline, in business days, for a request that only opts out, where the opt-out has
   * its own clock separate from the 45 days that apply to requests to know and delete.
   */
  optOutBusinessDays: number | null;
}

const ALL: StatuteTraits = {
  deleteScope: "all",
  citable: true,
  optOutAuthRule: null,
  optOutBusinessDays: null,
};
const PROVIDED: StatuteTraits = { ...ALL, deleteScope: "provided" };
const NOT_CITABLE: StatuteTraits = { ...ALL, citable: false };

interface StatuteEntry {
  statute: Statute;
  traits: StatuteTraits;
}

const BOTH = ["opt_out", "delete"] as const;

function comprehensive(
  fields: Omit<
    Statute,
    "kind" | "rights" | "brokerNotes" | "platform" | "notes" | "responseDaysChange"
  > &
    Partial<Pick<Statute, "rights" | "brokerNotes" | "platform" | "notes" | "responseDaysChange">>,
  traits: StatuteTraits = ALL,
): StatuteEntry {
  return {
    statute: {
      kind: "comprehensive",
      rights: [...BOTH],
      brokerNotes: null,
      platform: null,
      notes: null,
      responseDaysChange: null,
      ...fields,
    },
    traits,
  };
}

const GENERAL_BROKER_NOTE =
  "Applies to a data broker that meets the law's size thresholds, like any other controller. The law has no separate data broker section.";

/**
 * Every US state comprehensive privacy law enacted as of 2026-10-07, plus California's Delete Act.
 * Each entry cites the primary source it was read from; the dates they were checked are in the
 * package README.
 */
const STATUTE_ENTRIES: readonly StatuteEntry[] = [
  comprehensive(
    {
      id: "ca-ccpa",
      state: "CA",
      name: "California Consumer Privacy Act",
      citation: "Cal. Civ. Code 1798.100 et seq.",
      effectiveDate: "2020-01-01",
      responseDays: 45,
      extensionDays: 45,
      brokerNotes:
        "A data broker is a business under the Act when it meets a 1798.140(d)(1) threshold, usually (B), buying, selling, or sharing the personal information of 100,000 or more consumers or households, or (C), 50 percent or more of revenue from selling or sharing. Registered brokers must also process deletion requests made through DROP under the Delete Act.",
      sourceUrl:
        "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=CIV&division=3.&title=1.81.5.&part=4.&chapter=&article=",
      notes:
        "Amended by the California Privacy Rights Act from 2023-01-01. The opt-out covers sale and sharing of personal information. The deletion right reaches only personal information the business has collected from the consumer (1798.105(a)), so it does not reach a broker that collected the data elsewhere. A request that only opts out does not need to be a verifiable consumer request (11 CCR 7026(d)). A request that only opts out is owed action within 15 business days under 11 CCR 7026(f).",
    },
    PROVIDED,
  ),
  {
    statute: {
      id: "ca-delete-act",
      state: "CA",
      kind: "data_broker",
      name: "California Delete Act",
      citation: "Cal. Civ. Code 1798.99.80 et seq.",
      // The date brokers must start processing DROP requests (1798.99.86(c)(1)), not the Act's own
      // effective date, because basis selection starts when a request through DROP is honored.
      effectiveDate: "2026-08-01",
      rights: ["delete"],
      responseDays: 45,
      // AB 883 (Stats. 2026, ch. 507) cuts every Delete Act period from 45 to 30 days.
      responseDaysChange: { from: "2027-01-01", days: 30 },
      extensionDays: 0,
      brokerNotes:
        "Registered data brokers must check DROP at least every 45 days from 2026-08-01 and process the deletion requests they find there. From 2027-01-01 the cycle is every 30 days (AB 883, Stats. 2026, ch. 507).",
      platform: {
        name: "DROP (Delete Request and Opt-out Platform)",
        url: "https://privacy.ca.gov/drop/",
        note: "One request to every California-registered broker. Prefer it for a broker registered with California.",
      },
      sourceUrl: "https://privacy.ca.gov/drop-for-data-brokers/",
      notes:
        "Enacted as SB 362 (Stats. 2023, ch. 709). Under Civ. Code 1798.99.86 a consumer makes one verifiable request through DROP for deletion of all personal information related to them held by every registered broker, not only data collected from the consumer, which is the gap in CCPA 1798.105(a). From 2026-08-01 a broker must check DROP at least every 45 days, delete within 45 days, and keep deleting every 45 days after. AB 883 (approved 2026-09-27, Stats. 2026, ch. 507) amends 1798.99.86 to 30 days for each of those steps and for processing an unverifiable request as an opt-out. It has no operative date and no urgency clause, so it takes effect on 2027-01-01 under Cal. Const. art. IV, sec. 8(c)(1). The new 1798.99.86.5 for elected officials and judges is operative 2027-07-01. A request the broker cannot verify is processed as an opt-out of sale or sharing. Deletion is not owed where 1798.105(d), 1798.145, or 1798.146 allow retention. DROP opened to consumers on 2026-01-01.",
    },
    traits: ALL,
  },
  comprehensive({
    id: "va-vcdpa",
    state: "VA",
    name: "Virginia Consumer Data Protection Act",
    citation: "Va. Code 59.1-575 et seq.",
    effectiveDate: "2023-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://law.lis.virginia.gov/vacodefull/title59.1/chapter53/",
    notes:
      "From 2026-07-01 a controller may not sell or offer for sale precise geolocation data (59.1-578(A)(6), 2026 c. 820).",
  }),
  comprehensive({
    id: "co-cpa",
    state: "CO",
    name: "Colorado Privacy Act",
    citation: "Colo. Rev. Stat. 6-1-1301 et seq.",
    effectiveDate: "2023-07-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://leg.colorado.gov/sites/default/files/2021a_190_signed.pdf",
    notes:
      "Universal opt-out mechanisms are recognized from 2024-07-01. SB 24-041 created 6-1-1308.5 on minors under 18, with duties on or after 2025-10-01. SB 25-276 makes precise geolocation within 1,850 feet sensitive data and amends 6-1-1308(7) so a controller shall not process or sell a consumer's sensitive data without consent. Neither changes 6-1-1306.",
  }),
  comprehensive({
    id: "ct-ctdpa",
    state: "CT",
    name: "Connecticut Data Privacy Act",
    citation: "Conn. Gen. Stat. 42-515 et seq.",
    effectiveDate: "2023-07-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://www.cga.ct.gov/current/pub/chap_743jj.htm",
    notes:
      "The deadlines are unchanged, but the rights changed. P.A. 25-113 secs. 6 and 8, effective 2026-07-01, set the thresholds to 35,000 consumers, or any control or processing of sensitive data, or offering personal data for sale. They widen access to cover inferences and profiling, and add a right to question a profiling decision and a right to a list of the third parties the controller sold data to. Sec. 9 bars selling sensitive data without consent and targeted ads or sale for consumers known to be 13 to 17. P.A. 26-64 sec. 13, effective 2026-10-01, extends the 42-518(a)(3) deletion right to publicly available information that is collated and combined to create a consumer profile made available on a publicly accessible web site or made available for sale, and to any inference generated from it, which is the right used against people-search brokers. The opt-out authentication rule at 42-518(c)(4) is unchanged.",
  }),
  comprehensive(
    {
      id: "ut-ucpa",
      state: "UT",
      name: "Utah Consumer Privacy Act",
      citation: "Utah Code 13-61-101 et seq.",
      effectiveDate: "2023-12-31",
      responseDays: 45,
      extensionDays: 45,
      brokerNotes: GENERAL_BROKER_NOTE,
      sourceUrl: "https://le.utah.gov/xcode/Title13/Chapter61/13-61.html",
      notes:
        "The deletion right reaches only personal data the consumer provided to the business (13-61-201), so it does not reach a broker that collected the data elsewhere. From 2026-07-01 13-61-201(4) adds a right to correct (Chapter 468, 2025 General Session), and the deletion text is unchanged.",
    },
    PROVIDED,
  ),
  comprehensive({
    id: "tx-tdpsa",
    state: "TX",
    name: "Texas Data Privacy and Security Act",
    citation: "Tex. Bus. & Com. Code ch. 541",
    effectiveDate: "2024-07-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes:
      "Applies to data brokers like any other controller. Texas also requires brokers to register under Tex. Bus. & Com. Code ch. 509, which gives consumers no request right but, since 2025-09-01, requires the broker to say how to exercise rights under this chapter.",
    sourceUrl: "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm",
  }),
  comprehensive({
    id: "or-ocpa",
    state: "OR",
    name: "Oregon Consumer Privacy Act",
    citation: "Or. Rev. Stat. 646A.570 to 646A.589",
    effectiveDate: "2024-07-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes:
      "Applies to data brokers like any other controller. Oregon also requires brokers to register under ORS 646A.593, which gives consumers no request right.",
    sourceUrl: "https://www.oregonlegislature.gov/bills_laws/ors/ors646A.html",
    notes:
      "HB 2008 (2025 c. 251) adds ORS 646A.578, which bars selling the data of a consumer known to be under 16 and data that accurately identifies within a radius of 1,750 feet a consumer's present or past location. It is effective 2026-01-01 under ORS 171.022, because the enrolled bill has no date clause.",
  }),
  comprehensive({
    id: "mt-mcdpa",
    state: "MT",
    name: "Montana Consumer Data Privacy Act",
    citation: "Mont. Code Ann. 30-14-2801 et seq.",
    effectiveDate: "2024-10-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl:
      "https://mca.legmt.gov/bills/mca/title_0300/chapter_0140/part_0280/sections_index.html",
    notes: "Amendments from 2025-10-01 lowered the applicability thresholds.",
  }),
  comprehensive(
    {
      id: "fl-fdbr",
      state: "FL",
      name: "Florida Digital Bill of Rights",
      citation: "Fla. Stat. 501.701 et seq.",
      effectiveDate: "2024-07-01",
      responseDays: 45,
      extensionDays: 15,
      brokerNotes: null,
      sourceUrl: "https://www.flsenate.gov/Laws/Statutes/2025/Chapter501/Part_V",
      notes:
        "The consumer rights bind only controllers with more than 1 billion dollars in global revenue that also meet a further test, so this tool does not cite it. Only the sensitive data sale rule reaches other businesses.",
    },
    NOT_CITABLE,
  ),
  comprehensive({
    id: "de-dpdpa",
    state: "DE",
    name: "Delaware Personal Data Privacy Act",
    citation: "6 Del. C. ch. 12D",
    effectiveDate: "2025-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://delcode.delaware.gov/title6/c012d/index.html",
    notes:
      "85 Del. Laws c. 463 replaces 12D-102 to 12D-111 from 2027-01-01. The thresholds become 10,000 consumers, or 5,000 with more than 20 percent of revenue from sale, plus third parties who acquire personal data from a controller. Access covers inferences, and consumers get a list of specific third parties. The authentication rule at 12D-104(c)(4) is unchanged in the 2027 text.",
  }),
  comprehensive(
    {
      id: "ia-icdpa",
      state: "IA",
      name: "Iowa Consumer Data Protection Act",
      citation: "Iowa Code ch. 715D",
      effectiveDate: "2025-01-01",
      responseDays: 90,
      extensionDays: 45,
      brokerNotes: GENERAL_BROKER_NOTE,
      sourceUrl: "https://www.legis.iowa.gov/docs/code/715D.pdf",
      notes:
        "The response period is 90 days, the longest of any state. The deletion right reaches only data the consumer provided to the business.",
    },
    PROVIDED,
  ),
  comprehensive({
    id: "ne-ndpa",
    state: "NE",
    name: "Nebraska Data Privacy Act",
    citation: "Neb. Rev. Stat. 87-1101 et seq. (LB 1074, 2024)",
    effectiveDate: "2025-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://nebraskalegislature.gov/FloorDocs/108/PDF/Slip/LB1074.pdf",
  }),
  comprehensive({
    id: "nh-nhpa",
    state: "NH",
    name: "New Hampshire Privacy Act",
    citation: "N.H. Rev. Stat. Ann. ch. 507-H",
    effectiveDate: "2025-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://gc.nh.gov/rsa/html/LII/507-H/507-H-mrg.htm",
  }),
  comprehensive({
    id: "nj-njdpa",
    state: "NJ",
    name: "New Jersey Data Privacy Act",
    citation: "N.J. Stat. Ann. 56:8-166.4 et seq. (P.L. 2023, c. 266)",
    effectiveDate: "2025-01-15",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://pub.njleg.state.nj.us/Bills/2022/PL23/266_.PDF",
    notes:
      'P.L. 2026, c. 25 sec. 1 amends 56:8-166.12(a)(6): a controller may "not sell sensitive data, which shall apply to all individuals or legal entities regardless of the number of consumers".',
  }),
  comprehensive({
    id: "tn-tipa",
    state: "TN",
    name: "Tennessee Information Protection Act",
    citation: "Tenn. Code Ann. 47-18-3201 et seq.",
    effectiveDate: "2025-07-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://publications.tnsosfiles.com/acts/113/pub/pc0408.pdf",
    notes:
      "Public Chapter 408, effective 2025-07-01 (sec. 6). 47-18-3202 applies only to a person with revenue over 25,000,000 dollars that also controls or processes the data of 175,000 consumers, or of 25,000 consumers with more than 50 percent of revenue from the sale of personal data.",
  }),
  comprehensive({
    id: "mn-mcdpa",
    state: "MN",
    name: "Minnesota Consumer Data Privacy Act",
    citation: "Minn. Stat. 325M.10 to 325M.21",
    effectiveDate: "2025-07-31",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://www.revisor.mn.gov/statutes/cite/325M",
  }),
  comprehensive({
    id: "md-modpa",
    state: "MD",
    name: "Maryland Online Data Privacy Act of 2024",
    citation: "Md. Code, Com. Law 14-4701 et seq.",
    effectiveDate: "2025-10-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://mgaleg.maryland.gov/2024RS/bills/sb/sb0541E.pdf",
    notes:
      "SB 541 numbers the act 14-4601 et seq., and the Code codifies it as 14-4701 et seq. In effect from 2025-10-01 (SB 541 sec. 4). SB 541 sec. 2 limits only the exceptions section (enacted as 14-4612, now 14-4712) to processing on or after 2026-04-01. HB 711 of 2026 (Chapter 874, effective 2026-07-01) bars selling personal data to a governmental unit that engaged in or supported civil immigration enforcement.",
  }),
  comprehensive({
    id: "in-icdpa",
    state: "IN",
    name: "Indiana Consumer Data Protection Act",
    citation: "Ind. Code art. 24-15",
    effectiveDate: "2026-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://iga.in.gov/laws/2025/ic/titles/24",
  }),
  comprehensive({
    id: "ky-kcdpa",
    state: "KY",
    name: "Kentucky Consumer Data Protection Act",
    citation: "Ky. Rev. Stat. 367.3611 et seq. (HB 15, 2024)",
    effectiveDate: "2026-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://apps.legislature.ky.gov/recorddocuments/bill/24RS/hb15/bill.pdf",
  }),
  comprehensive({
    id: "ri-dtppa",
    state: "RI",
    name: "Rhode Island Data Transparency and Privacy Protection Act",
    citation: "R.I. Gen. Laws 6-48.1-1 et seq.",
    effectiveDate: "2026-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://webserver.rilegislature.gov/Statutes/TITLE6/6-48.1/INDEX.HTM",
  }),
  comprehensive({
    id: "ok-ocdpa",
    state: "OK",
    name: "Oklahoma Consumer Data Privacy Act",
    citation: "Okla. Stat. tit. 75A, 300 et seq. (SB 546, 2026)",
    effectiveDate: "2027-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://www.oklegislature.gov/cf_pdf/2025-26%20ENR/SB/SB546%20ENR.PDF",
    notes:
      "Signed 2026-03-20. The enrolled bill has no short title; the name is the one law firm summaries use.",
  }),
  comprehensive({
    id: "la-ldpa",
    state: "LA",
    name: "Louisiana Data Privacy Act",
    citation: "La. R.S. 51:1780.1 to 1780.5 (Acts 2026, No. 502, SB 386)",
    effectiveDate: "2027-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://legis.la.gov/legis/ViewDocument.aspx?d=1480202",
    notes:
      "Signed 2026-05-29. The 45 calendar days plus one 45 day extension are in R.S. 51:1780.3(B)(2).",
  }),
  comprehensive({
    id: "al-apdpa",
    state: "AL",
    name: "Alabama Personal Data Protection Act",
    citation: "Ala. Act 2026-552 (HB 351)",
    effectiveDate: "2027-05-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl:
      "https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB351-enr.pdf",
    notes: "Signed 2026-04-17. The act is uncodified, and its 45 plus 45 days are in sec. 5(d)(1).",
  }),
  comprehensive({
    id: "vt-vdposa",
    state: "VT",
    name: "Vermont Data Privacy and Online Surveillance Act",
    citation: "9 V.S.A. ch. 61A, 2415a to 2415k (Act 145 of 2026, S.71)",
    effectiveDate: "2028-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes:
      "Applies to data brokers like any other controller. Vermont's separate broker registration law (9 V.S.A. 2430, 2446, 2447) gives consumers no request right.",
    sourceUrl:
      "https://legislature.vermont.gov/Documents/2026/Docs/ACTS/ACT145/ACT145%20As%20Enacted.pdf",
    notes: "Signed 2026-06-16. The 45 plus 45 days are in 2415d(c)(1).",
  }),
  {
    statute: {
      id: "nv-nrs-603a",
      state: "NV",
      kind: "data_broker",
      name: "Nevada Revised Statutes chapter 603A",
      citation: "Nev. Rev. Stat. 603A.345 and 603A.346",
      effectiveDate: "2021-10-01",
      rights: ["opt_out"],
      responseDays: 60,
      responseDaysChange: null,
      extensionDays: 30,
      brokerNotes:
        "A data broker, meaning a person whose primary business is buying covered information about Nevada residents with whom it has no direct relationship, from operators or other brokers, and selling it, must keep a designated request address for verified requests not to sell covered information it has purchased or will purchase, and must answer within 60 days (NRS 603A.323, 603A.346).",
      platform: null,
      sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-603A.html",
      notes:
        "Nevada is not a comprehensive privacy law, and NRS 603A.345 and 603A.346 give no deletion right. Chapter 603A does give one for consumer health data (NRS 603A.505(1)(d), with a duty to cease collecting, sharing, or selling it under (c), from SB 370, effective 2024-03-31), but only to a consumer who has requested a product or service from a regulated entity (603A.425), so it does not reach ordinary brokers. NRS 603A.345 binds operators of websites and online services (SB 220, 2019, from 2019-10-01) and NRS 603A.346 binds data brokers (SB 260, 2021, from 2021-10-01), which is the date used here because it is the later of the two. The request must be a verified request that the business can verify with commercially reasonable means (NRS 603A.337), so the email never says the opt-out needs no authentication. A sale is an exchange of covered information for monetary consideration (NRS 603A.333), and covered information is limited to what an operator collected through its website or online service (NRS 603A.320). Consumer reporting agencies, personal information regulated by the Fair Credit Reporting Act, regulated financial institutions, publicly available information, collection and sale for fraud prevention, information protected by the Driver's Privacy Protection Act, and consumer health data under 603A.400 to 603A.550 are excluded (NRS 603A.338).",
    },
    traits: ALL,
  },
];

export const STATUTES: readonly Statute[] = STATUTE_ENTRIES.map((entry) => entry.statute);

/**
 * Each entry quotes the rule it rests on. California says a business "shall not require a
 * verifiable consumer request" for an opt-out of sale or sharing. Connecticut, Delaware, Minnesota,
 * Montana, New Hampshire, New Jersey, Rhode Island, Maryland, Alabama, and Vermont say a controller
 * is not required to authenticate an opt-out request. Oregon says to comply "without requiring
 * authentication". None of them forbids asking for what is needed to find the record, and
 * California (11 CCR 7026(d)) and Oregon (646A.576(5)(e)(A)) say so expressly, so the email never
 * says no identifying detail may be asked for.
 * Louisiana was read and has only the general authentication rule (R.S. 51:1780.3(B)(5)), so it is
 * left out. The Alabama and Vermont rules apply only once each law takes effect.
 * Colorado is left out on purpose. Its statute has no such rule and its Rule 4.08 requires
 * authentication of every consumer data right request. Only a universal opt-out signal (Rule 5.08)
 * is exempt there. Texas, Utah, Virginia, Iowa, Nebraska, Tennessee, Kentucky, Indiana, and
 * Oklahoma have no such rule in their text.
 */
const OPT_OUT_AUTH_RULES = new Map([
  ["al-apdpa", "Ala. Act 2026-552, sec. 5(d)(4)"],
  ["ca-ccpa", "11 CCR 7026(d)"],
  ["ct-ctdpa", "Conn. Gen. Stat. 42-518(c)(4)"],
  ["de-dpdpa", "6 Del. C. 12D-104(c)(4)"],
  ["md-modpa", "Md. Code, Com. Law 14-4705(e)(6)"],
  ["mn-mcdpa", "Minn. Stat. 325M.14, subd. 4(h)"],
  ["mt-mcdpa", "Mont. Code Ann. 30-14-2808(4)(d)"],
  ["nh-nhpa", "N.H. Rev. Stat. Ann. 507-H:4, III(d)"],
  ["nj-njdpa", "N.J.S.A. 56:8-166.7(e)"],
  ["or-ocpa", "Or. Rev. Stat. 646A.576(5)(e)"],
  ["ri-dtppa", "R.I. Gen. Laws 6-48.1-6(b)(4)"],
  ["vt-vdposa", "9 V.S.A. 2415d(c)(4)(B)"],
]);

/** CCPA regulation 11 CCR 7026(f) gives 15 business days to stop selling or sharing. */
const OPT_OUT_BUSINESS_DAYS = new Map([["ca-ccpa", 15]]);

const TRAITS = new Map(
  STATUTE_ENTRIES.map(({ statute, traits }) => [
    statute.id,
    {
      ...traits,
      optOutAuthRule: OPT_OUT_AUTH_RULES.get(statute.id) ?? null,
      optOutBusinessDays: OPT_OUT_BUSINESS_DAYS.get(statute.id) ?? null,
    },
  ]),
);

/**
 * Splits the rights a request asks for into those the statute reaches for this kind of target and
 * those it does not. A broker never received the data from the person, so a deletion right
 * limited to data the person provided does not reach it.
 */
export function splitRights(
  statute: Statute,
  rights: readonly RequestRight[],
  targetKind: "broker" | "company",
): { covered: RequestRight[]; uncovered: RequestRight[] } {
  const { deleteScope } = traitsOf(statute.id);
  const covered: RequestRight[] = [];
  const uncovered: RequestRight[] = [];
  for (const right of rights) {
    const reaches =
      statute.rights.includes(right) &&
      !(right === "delete" && deleteScope === "provided" && targetKind === "broker");
    (reaches ? covered : uncovered).push(right);
  }
  return { covered, uncovered };
}

export function traitsOf(statuteId: string): StatuteTraits {
  const traits = TRAITS.get(statuteId);
  if (!traits) throw new Error(`No traits for statute ${statuteId}`);
  return traits;
}
