# @kickrocks/legal

State privacy law data, legal basis selection, identifier minimization, and request email templates.

The server calls five functions: `resolveLegalBasis`, `getLegalBasis`, `listJurisdictions`, `identifiersFor`, and `renderRequestEmail`.
Everything is a pure function of its inputs and the data in `src/statutes.ts` and `src/broker-laws.ts`.

## How a basis is chosen

1. California, a broker whose record comes from the California registry (`californiaRegistered` in the code), and a request for deletion only: the California Delete Act, from 2026-08-01.
   The statute carries the DROP platform, which is the better route for that broker.
2. Otherwise the first statute of the person's state that is in effect on `asOf`, is citable, and covers at least one right asked for.
   The email cites the statute for the rights it covers and asks for the rest under the business's own policy.
3. Otherwise a policy basis that asks the business to honor its own published privacy commitments, with a 45 day response period.

Three rules are held back or narrowed on purpose.

- California, Utah, and Iowa limit deletion to data the person provided to the business, so a deletion request to a broker is not a statutory request there.
  A two-right request to a broker cites the statute for the opt-out and asks for deletion under policy.
  A deletion request to a company still cites the statute, worded as the data the person provided.
- Florida's consumer rights bind only controllers with more than 1 billion dollars in revenue, which this tool cannot know for a target, so it is never cited.
- Nevada has no comprehensive law, but NRS 603A.345 (operators, SB 220 of 2019) and NRS 603A.346 (data brokers, SB 260 of 2021) let a resident direct an operator or a data broker not to sell covered information, with 60 days to answer and 30 more on request.
  It gives no deletion right, and it needs a verified request (NRS 603A.337), so the email never says the opt-out needs no authentication there.
  "Sale" means an exchange for monetary consideration, covered information is limited to what an operator collected through its website or online service, and consumer reporting agencies, regulated financial institutions, and publicly available information are excluded, so the email asks only "to the extent it applies to you".

The email says an opt-out of sale does not have to be authenticated only where the enacted text or regulation says so, and it cites the provision (`optOutAuthRule` in `src/statutes.ts`).
The statements are narrower than "no proof of identity".
California says a business "shall not require a verifiable consumer request" for an opt-out and may still ask for what it needs to identify the consumer (11 CCR 7026(d)).
Connecticut, Delaware, Minnesota, Montana, New Hampshire, New Jersey, and Rhode Island say a controller is not required to authenticate an opt-out request, but may deny one it documents as fraudulent.
Maryland (14-4605(e)(6)) says only that a controller may not be required to authenticate an opt-out request.
Oregon says to comply "without requiring authentication", and the controller may ask for information needed to identify the consumer.
The email therefore adds that the business should say which detail it needs to find the record.
Colorado is left out: its statute has no such rule, and Rule 4.08 (4 CCR 904-3) requires authentication of every consumer data right request, with the exemption (Rule 5.08) limited to a universal opt-out signal.
Texas, Utah, Virginia, Iowa, Nebraska, Tennessee, Kentucky, Indiana, and Oklahoma were read and have no such rule.
Florida, Alabama, Louisiana, and Vermont (S.71) are not claimed, because the Florida law is not cited and the enrolled text of the other three was not readable.
Everywhere else the email asks politely not to be asked for ID, an account, or a fee.
A California request that only opts out is owed action within 15 business days (11 CCR 7026(f)), recorded as 21 calendar days, and has no extension.

The Delete Act is routing information.
The person's right under it is exercised through DROP, so the email asks the broker to honor the request without claiming a right to demand it by email.

### California deletion and DROP

CCPA Civ. Code 1798.105(a) gives a right to have deleted "any personal information about the consumer which the business has collected from the consumer".
A data broker by definition has no direct relationship with the consumer, so the CCPA deletion right does not reach what it holds.
DROP under Civ. Code 1798.99.86 deletes "all personal information related to that consumer" held by every registered broker, whatever its source.
From 2026-08-01 a registered broker must check DROP at least every 45 days, delete within 45 days of a request, and keep deleting every 45 days.
A request the broker cannot verify is processed as an opt-out of sale or sharing, and deletion is not owed where 1798.105(d), 1798.145, or 1798.146 allow retention.

`recommendDrop` tells the caller when to point the person to DROP instead of, or next to, an email.
It recommends DROP when the person lives in California, the target is a broker registered with California, a deletion is asked for (alone or with an opt-out), and the date is on or after 2026-08-01.
It does not recommend DROP for an opt-out alone, because DROP is a deletion request the person did not ask for, even though DROP also stops future sale or sharing (Civ. Code 1798.99.86(d)).
It does not recommend it for a broker outside the California registry, for a company, or before the processing date.
The library still resolves the Delete Act basis for a deletion-only request to a registered broker, but the server's campaign planner does not email it: it skips that target as covered by the platform and tells the person to file at DROP.
A two-right request keeps the CCPA opt-out email, and the planner adds an advisory that DROP can also delete what the broker holds.
A deletion request to a company stays a CCPA request for the data the person provided.

The law only says "to the extent it applies to you" because every statute has size thresholds the tool cannot check for a given business.

The data broker registration laws of Vermont, Texas, Oregon, and New Jersey are in `src/broker-laws.ts`.
They make a broker register and publish how a consumer can opt out, and give the consumer no right to demand anything, so they are never the basis of a request.

`getLegalBasis` returns a stored id as it was, so a follow-up cites the statute the first request cited.

## Data minimization

| Purpose | Fields |
|---|---|
| `email` | name and email; city and state added for people-search and background-check targets |
| `scan` | first name, last name, city, state |
| `remove` | first name, last name, full name, email; city and state added where a record is needed |

Date of birth, birth year, street, phone, and zip are disclosed only through `requestedFields`, which a recipe or an approved broker reply supplies.

## Sources

Checked on 2026-10-07 by reading the primary source where the site served it to a script, and otherwise by confirming against law firm summaries.
Statutes with a deadline or right that came only from a summary say so in their `notes`.

| State | Law | Effective | Primary source |
|---|---|---|---|
| CA | California Consumer Privacy Act | 2020-01-01 | https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=CIV&division=3.&title=1.81.5.&part=4.&chapter=&article= |
| CA | California Delete Act and DROP | 2026-08-01 | https://privacy.ca.gov/drop-for-data-brokers/ |
| VA | Consumer Data Protection Act | 2023-01-01 | https://law.lis.virginia.gov/vacodefull/title59.1/chapter53/ |
| CO | Colorado Privacy Act | 2023-07-01 | https://leg.colorado.gov/sites/default/files/2021a_190_signed.pdf |
| CT | Connecticut Data Privacy Act | 2023-07-01 | https://www.cga.ct.gov/current/pub/chap_743jj.htm |
| NV | Nevada Revised Statutes chapter 603A (SB 260) | 2021-10-01 | https://www.leg.state.nv.us/NRS/NRS-603A.html |
| UT | Utah Consumer Privacy Act | 2023-12-31 | https://le.utah.gov/xcode/Title13/Chapter61/13-61.html |
| TX | Texas Data Privacy and Security Act | 2024-07-01 | https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm |
| OR | Oregon Consumer Privacy Act | 2024-07-01 | https://www.oregonlegislature.gov/bills_laws/ors/ors646A.html |
| MT | Montana Consumer Data Privacy Act | 2024-10-01 | https://mca.legmt.gov/bills/mca/title_0300/chapter_0140/part_0280/sections_index.html |
| FL | Florida Digital Bill of Rights | 2024-07-01 | https://www.flsenate.gov/Laws/Statutes/2025/Chapter501/Part_V |
| DE | Personal Data Privacy Act | 2025-01-01 | https://delcode.delaware.gov/title6/c012d/index.html |
| IA | Consumer Data Protection Act | 2025-01-01 | https://www.legis.iowa.gov/docs/code/715D.pdf |
| NE | Data Privacy Act | 2025-01-01 | https://nebraskalegislature.gov/FloorDocs/108/PDF/Slip/LB1074.pdf |
| NH | Privacy Act | 2025-01-01 | https://gc.nh.gov/rsa/html/NHTOC/NHTOC-LII-507-H.htm |
| NJ | Data Privacy Act | 2025-01-15 | https://pub.njleg.state.nj.us/Bills/2022/PL23/266_.PDF |
| TN | Information Protection Act | 2025-07-01 | https://www.capitol.tn.gov/Bills/113/Amend/HA0348.pdf |
| MN | Consumer Data Privacy Act | 2025-07-31 | https://www.revisor.mn.gov/statutes/cite/325M |
| MD | Online Data Privacy Act of 2024 | 2025-10-01 | https://mgaleg.maryland.gov/2024RS/bills/sb/sb0541E.pdf |
| IN | Consumer Data Protection Act | 2026-01-01 | https://iga.in.gov/laws/2025/ic/titles/24 |
| KY | Consumer Data Protection Act | 2026-01-01 | https://apps.legislature.ky.gov/recorddocuments/bill/24RS/hb15/bill.pdf |
| RI | Data Transparency and Privacy Protection Act | 2026-01-01 | https://webserver.rilegislature.gov/Statutes/TITLE6/6-48.1/INDEX.HTM |
| OK | Consumer Data Privacy Act (SB 546) | 2027-01-01 | https://www.oklegislature.gov/cf_pdf/2025-26%20ENR/SB/SB546%20ENR.PDF |
| LA | Data Privacy Act (SB 386, Act 502) | 2027-01-01 | https://legis.la.gov/legis/ViewDocument.aspx?d=1480202 |
| AL | Personal Data Protection Act (HB 351) | 2027-05-01 | https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB351-enr.pdf |
| VT | Data Privacy and Online Surveillance Act (S.71, Act 145) | 2028-01-01 | https://legislature.vermont.gov/Documents/2026/Docs/ACTS/ACT145/ACT145%20As%20Enacted.pdf |

Data broker registration laws, which give consumers no request right:

| State | Law | Effective | Primary source |
|---|---|---|---|
| VT | 9 V.S.A. 2430, 2446, 2447, amended by Act 138 of 2026 | 2019-01-01 | https://legislature.vermont.gov/statutes/section/09/062/02446 |
| TX | Tex. Bus. & Com. Code ch. 509 | 2023-09-01 | https://statutes.capitol.texas.gov/Docs/BC/htm/BC.509.htm |
| OR | Or. Rev. Stat. 646A.593 | 2024-01-01 | https://www.oregonlegislature.gov/bills_laws/ors/ors646A.html |
| NJ | P.L. 2026, c. 25 (A5328), N.J.S.A. 56:8-166.20 to 56:8-166.24, approved 2026-06-30 | 2026-06-30 | https://pub.njleg.state.nj.us/Bills/2026/PL26/25_.PDF |

### Legal accuracy pass, checked 2026-10-07

New Jersey.
The consumer rights law is P.L. 2023, c. 266, codified at N.J.S.A. 56:8-166.4 to 56:8-166.19, and its authentication clause is section 4 (C.56:8-166.7(e)).
A5328 is not the consumer rights law.
It is the data broker and data collector act, enacted as P.L. 2026, c. 25 and codified at N.J.S.A. 56:8-166.20 to 56:8-166.24.
It was read from the enrolled chapter text.
It took effect on 2026-06-30, the public registry is inoperative for 270 days (2027-03-27), and it also amends 56:8-166.12 to bar the sale of sensitive data.
The earlier note of a registration period from 2027-04-01 to 2027-06-30 is not in the enrolled text and was removed.

Nevada.
The statute was already in `src/statutes.ts`, and its text was read from https://www.leg.state.nv.us/NRS/NRS-603A.html (Rev. 4/15/2026, 2025 session).
Sections read: 603A.320, 603A.323, 603A.333, 603A.337, 603A.338, 603A.345, 603A.346, and 603A.360.
Effective dates (2019-10-01 for operators, 2021-10-01 for brokers) come from the session law citations in the NRS and law firm summaries of SB 220 and SB 260.

Opt-out authentication.
Read from the enrolled or codified text: Connecticut 42-518(c)(4), Delaware 12D-104(c)(4), Maryland 14-4605(e)(6), Minnesota 325M.14 subd. 4(h), New Jersey 56:8-166.7(e), Oregon 646A.576(5)(e), Rhode Island 6-48.1-6(b)(4), and Colorado C.R.S. 6-1-1306(2)(d) with Rules 4.08 and 5.08.
California 11 CCR 7026(d) and (f) were read from the Cornell LII copy of the regulations, and Montana 30-14-2808(4)(d) and New Hampshire 507-H:4, III(d) from the legislature pages.

California deletion.
Civ. Code 1798.105 was read from the CPPA's posted statute (effective 2025-01-01), and 1798.99.86 from the codified text on california.public.law, which mirrors the Legislative Counsel text.
SB 362 is Stats. 2023, ch. 709.
The privacy.ca.gov DROP page confirms the 2026-08-01 date and the 45 day cycle.
leginfo.legislature.ca.gov served only a script challenge, so the primary URL in the table is the page the data cites and not the page that was parsed.

What was read directly and what was not:

- Read from the enrolled or codified text: Virginia, Connecticut, Iowa, Delaware, Minnesota, Maryland, Tennessee, Kentucky, Nebraska, New Jersey (both acts), Colorado, Oregon, Rhode Island, Oklahoma, Nevada, and the Vermont broker section and Oregon broker section.
- Also read from the primary text:
  - Utah 13-61-203 (45 + 45, effective 12/31/2023): https://le.utah.gov/xcode/Title13/Chapter61/C13-61-S203_2022050420231231.html
  - Texas enrolled HB 4 (45th day + 45, SECTION 7 effective July 1, 2024): https://capitol.texas.gov/tlodocs/88R/billtext/pdf/HB00004F.pdf
  - Montana 30-14-2808: https://mca.legmt.gov/bills/mca/title_0300/chapter_0140/part_0280/section_0080/0300-0140-0280-0080.html
  - New Hampshire 507-H: https://gc.nh.gov/rsa/html/LII/507-H/507-H-mrg.htm
  - Louisiana Act 502: https://legis.la.gov/legis/ViewDocument.aspx?d=1480202
  - Alabama HB 351 as enrolled: https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB351-enr.pdf
  - Vermont Act 145 (S.71) as enacted: https://legislature.vermont.gov/Documents/2026/Docs/ACTS/ACT145/ACT145%20As%20Enacted.pdf
- California and Florida were confirmed from the statute sections as quoted by other sources and from the California agency pages.
- Indiana's 45 + 45 and its 2026-01-01 date are confirmed by the Attorney General, the enforcing agency: https://www.in.gov/attorneygeneral/files/Indiana-Consumer-Data-Protection-Consumer-Bill-of-Rights_Web.pdf
- The Louisiana, Alabama, and Vermont (S.71) section numbers were not confirmed.
- Connecticut's 2025 amendments (2026-07-01), Montana's 2025 amendments, Maryland's 2026 amendments, and Vermont Act 138 of 2026 (broker registration, 2027-01-01) were noted from law firm summaries.
  None changes a consumer right or deadline used here.

California's DROP: consumers could submit requests from 2026-01-01, and brokers must process them from 2026-08-01 and at least every 45 days after.
A direct request to a broker stays valid next to DROP.

## Tests

`pnpm --filter @kickrocks/legal test` runs the data checks (every statute has a primary source URL and a valid effective date), the basis rules, the identifier rules, and a snapshot of every email for all 51 jurisdictions, three kinds, and three right sets, plus the 2026 laws once they take effect and the target variants.
Review `src/__snapshots__/email.test.ts.snap` whenever a template or statute changes.
The tests also pin the opt-out authentication rule per state, check that the claim is absent for Colorado and every state without a sourced rule, and cover `recommendDrop`.

## Known gaps

- The authentication rules of Alabama, Louisiana, and Vermont (S.71) were not readable, and Texas, Utah, Virginia, Iowa, Nebraska, Tennessee, Kentucky, Indiana, and Oklahoma have none, so the email makes no claim there.
- The California regulations 11 CCR 7026(d) and (f) and the Montana and New Hampshire sections were confirmed from secondary hosts of the official text, not the agency or legislature copy.
- New Jersey's implementing rules under the Data Privacy Act were not reviewed.
- Nevada's NRS 603A.345 took effect two years before the entry's date, which is the broker date.
- Kick Rocks never files at DROP for the person, because DROP needs the person's own identity verification.
It only points to it.
