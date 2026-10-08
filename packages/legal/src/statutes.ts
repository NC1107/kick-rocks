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

interface StatuteEntry {
  statute: Statute;
  traits: StatuteTraits;
}

const BOTH = ["opt_out", "delete"] as const;

function comprehensive(
  fields: Omit<Statute, "kind" | "rights" | "brokerNotes" | "platform" | "notes"> &
    Partial<Pick<Statute, "rights" | "brokerNotes" | "platform" | "notes">>,
  traits: StatuteTraits = ALL,
): StatuteEntry {
  return {
    statute: {
      kind: "comprehensive",
      rights: [...BOTH],
      brokerNotes: null,
      platform: null,
      notes: null,
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
        "Data brokers are businesses under the Act. Registered brokers must also process deletion requests made through DROP under the Delete Act.",
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
      effectiveDate: "2026-08-01",
      rights: ["delete"],
      responseDays: 45,
      extensionDays: 0,
      brokerNotes:
        "Registered data brokers must check DROP at least every 45 days from 2026-08-01 and process the deletion requests they find there.",
      platform: {
        name: "DROP (Delete Request and Opt-out Platform)",
        url: "https://privacy.ca.gov/drop/",
        note: "One request to every California-registered broker. Prefer it for a broker registered with California.",
      },
      sourceUrl: "https://privacy.ca.gov/drop-for-data-brokers/",
      notes:
        "Enacted as SB 362 (Stats. 2023, ch. 709). Under Civ. Code 1798.99.86 a consumer makes one verifiable request through DROP for deletion of all personal information related to them held by every registered broker, not only data collected from the consumer, which is the gap in CCPA 1798.105(a). From 2026-08-01 a broker must check DROP at least every 45 days, delete within 45 days, and keep deleting every 45 days after. A request the broker cannot verify is processed as an opt-out of sale or sharing. Deletion is not owed where 1798.105(d), 1798.145, or 1798.146 allow retention. DROP opened to consumers on 2026-01-01.",
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
    notes: "Universal opt-out mechanisms are recognized from 2024-07-01.",
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
      "2025 amendments take effect on 2026-07-01 and lower the applicability thresholds. The consumer rights and deadlines are unchanged.",
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
        "The deletion right reaches only personal data the consumer provided to the business, so it does not reach a broker that collected the data elsewhere.",
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
      "Applies to data brokers like any other controller. Texas also requires brokers to register under Tex. Bus. & Com. Code ch. 509, which gives consumers no request right.",
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
    { ...ALL, citable: false },
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
    sourceUrl: "https://gc.nh.gov/rsa/html/NHTOC/NHTOC-LII-507-H.htm",
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
    sourceUrl: "https://www.capitol.tn.gov/Bills/113/Bill/HB1181.pdf",
  }),
  comprehensive({
    id: "mn-mcdpa",
    state: "MN",
    name: "Minnesota Consumer Data Privacy Act",
    citation: "Minn. Stat. ch. 325M",
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
    citation: "Md. Code, Com. Law 14-4601 et seq.",
    effectiveDate: "2025-10-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://mgaleg.maryland.gov/2024RS/bills/sb/sb0541E.pdf",
    notes: "Its duties apply to personal data processing from 2026-04-01.",
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
    citation: "La. Acts 2026, No. 502 (SB 386)",
    effectiveDate: "2027-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://legis.la.gov/legis/BillInfo.aspx?s=26RS&b=SB386&sbi=y",
    notes:
      "Signed 2026-05-29. The response deadlines were read from law firm summaries, not the enrolled text, and the Revised Statutes numbers were not confirmed.",
  }),
  comprehensive({
    id: "al-apdpa",
    state: "AL",
    name: "Alabama Personal Data Protection Act",
    citation: "2026 Ala. Acts (HB 351)",
    effectiveDate: "2027-05-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes: GENERAL_BROKER_NOTE,
    sourceUrl: "https://alison.legislature.state.al.us/bill/2026RS/HB351",
    notes:
      "Signed 2026-04-17. The response deadlines were read from law firm summaries, not the enrolled text, and the Code of Alabama numbers were not confirmed.",
  }),
  comprehensive({
    id: "vt-vdposa",
    state: "VT",
    name: "Vermont Data Privacy and Online Surveillance Act",
    citation: "2026 Vt. Acts, No. 145 (S.71)",
    effectiveDate: "2028-01-01",
    responseDays: 45,
    extensionDays: 45,
    brokerNotes:
      "Applies to data brokers like any other controller. Vermont's separate broker registration law (9 V.S.A. 2430, 2446, 2447) gives consumers no request right.",
    sourceUrl: "https://legislature.vermont.gov/bill/status/2026/S.71",
    notes:
      "Signed 2026-06-16. The response deadline was read from a law firm summary, not the enrolled text.",
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
      extensionDays: 30,
      brokerNotes:
        "A data broker, meaning a person whose primary business is buying covered information about Nevada residents from operators or other brokers and selling it, must keep a designated request address for verified requests not to sell covered information it has purchased or will purchase, and must answer within 60 days (NRS 603A.323, 603A.346).",
      platform: null,
      sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-603A.html",
      notes:
        "Nevada is not a comprehensive privacy law and gives no deletion right. NRS 603A.345 binds operators of websites and online services (SB 220, 2019, from 2019-10-01) and NRS 603A.346 binds data brokers (SB 260, 2021, from 2021-10-01), which is the date used here because it is the later of the two. The request must be a verified request that the business can verify with commercially reasonable means (NRS 603A.337), so the email never says the opt-out needs no authentication. A sale is an exchange of covered information for monetary consideration (NRS 603A.333), and covered information is limited to what an operator collected through its website or online service (NRS 603A.320). Consumer reporting agencies, regulated financial institutions, and publicly available information are excluded (NRS 603A.338).",
    },
    traits: ALL,
  },
];

export const STATUTES: readonly Statute[] = STATUTE_ENTRIES.map((entry) => entry.statute);

/**
 * Each entry quotes the rule it rests on. California says a business "shall not require a
 * verifiable consumer request" for an opt-out of sale or sharing. Connecticut, Delaware, Minnesota,
 * Montana, New Hampshire, New Jersey, Rhode Island, and Maryland say a controller is not required
 * to authenticate an opt-out request. Oregon says to comply "without requiring authentication".
 * All of them still let the controller ask for what it needs to identify the consumer, so the
 * email never says no identifying detail may be asked for.
 * Colorado is left out on purpose. Its statute has no such rule and its Rule 4.08 requires
 * authentication of every consumer data right request. Only a universal opt-out signal (Rule 5.08)
 * is exempt there. Texas, Utah, Virginia, Iowa, Nebraska, Tennessee, Kentucky, Indiana, and
 * Oklahoma have no such rule in their text.
 */
const OPT_OUT_AUTH_RULES = new Map([
  ["ca-ccpa", "11 CCR 7026(d)"],
  ["ct-ctdpa", "Conn. Gen. Stat. 42-518(c)(4)"],
  ["de-dpdpa", "6 Del. C. 12D-104(c)(4)"],
  ["md-modpa", "Md. Code, Com. Law 14-4605(e)(6)"],
  ["mn-mcdpa", "Minn. Stat. 325M.14, subd. 4(h)"],
  ["mt-mcdpa", "Mont. Code Ann. 30-14-2808(4)(d)"],
  ["nh-nhpa", "N.H. Rev. Stat. Ann. 507-H:4, III(d)"],
  ["nj-njdpa", "N.J.S.A. 56:8-166.7(e)"],
  ["or-ocpa", "Or. Rev. Stat. 646A.576(5)(e)"],
  ["ri-dtppa", "R.I. Gen. Laws 6-48.1-6(b)(4)"],
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
