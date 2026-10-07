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
- Nevada has no comprehensive law, but NRS 603A.345 and 603A.346 (SB 260 of 2021) let a resident direct an operator or a data broker not to sell covered information, with 60 days to answer and 30 more on request.
  It gives no deletion right, and it needs a verified request, so the email never says the opt-out needs no proof of identity there.

The email says an opt-out needs no proof of identity only for statutes that say so (`optOutAuthExempt` in `src/statutes.ts`).
Everywhere else it asks politely not to be asked for ID, an account, or a fee.
A California request that only opts out is owed action within 15 business days (11 CCR 7026(f)), recorded as 21 calendar days, and has no extension.

The Delete Act is routing information.
The person's right under it is exercised through DROP, so the email asks the broker to honor the request without claiming a right to demand it by email.

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
| TN | Information Protection Act | 2025-07-01 | https://www.capitol.tn.gov/Bills/113/Bill/HB1181.pdf |
| MN | Consumer Data Privacy Act | 2025-07-31 | https://www.revisor.mn.gov/statutes/cite/325M |
| MD | Online Data Privacy Act of 2024 | 2025-10-01 | https://mgaleg.maryland.gov/2024RS/bills/sb/sb0541E.pdf |
| IN | Consumer Data Protection Act | 2026-01-01 | https://iga.in.gov/laws/2025/ic/titles/24 |
| KY | Consumer Data Protection Act | 2026-01-01 | https://apps.legislature.ky.gov/recorddocuments/bill/24RS/hb15/bill.pdf |
| RI | Data Transparency and Privacy Protection Act | 2026-01-01 | https://webserver.rilegislature.gov/Statutes/TITLE6/6-48.1/INDEX.HTM |
| OK | Consumer Data Privacy Act (SB 546) | 2027-01-01 | https://www.oklegislature.gov/cf_pdf/2025-26%20ENR/SB/SB546%20ENR.PDF |
| LA | Data Privacy Act (SB 386, Act 502) | 2027-01-01 | https://legis.la.gov/legis/BillInfo.aspx?s=26RS&b=SB386&sbi=y |
| AL | Personal Data Protection Act (HB 351) | 2027-05-01 | https://alison.legislature.state.al.us/bill/2026RS/HB351 |
| VT | Data Privacy and Online Surveillance Act (S.71, Act 145) | 2028-01-01 | https://legislature.vermont.gov/bill/status/2026/S.71 |

Data broker registration laws, which give consumers no request right:

| State | Law | Effective | Primary source |
|---|---|---|---|
| VT | 9 V.S.A. 2430, 2446, 2447, amended by Act 138 of 2026 | 2019-01-01 | https://legislature.vermont.gov/statutes/section/09/062/02446 |
| TX | Tex. Bus. & Com. Code ch. 509 | 2023-09-01 | https://statutes.capitol.texas.gov/Docs/BC/htm/BC.509.htm |
| OR | Or. Rev. Stat. 646A.593 | 2024-01-01 | https://www.oregonlegislature.gov/bills_laws/ors/ors646A.html |
| NJ | N.J. A5328 (2026), signed 2026-06-30 | 2026-06-30 | https://www.njleg.state.nj.us/bill-search/2026/A5328 |

What was read directly and what was not:

- Read from the enrolled or codified text: Virginia, Connecticut, Iowa, Delaware, Minnesota, Maryland, Tennessee, Kentucky, Nebraska, New Jersey, Colorado, Oregon, Rhode Island, Oklahoma, and the Vermont broker section and Oregon broker section.
- California, Utah, Texas, Montana, New Hampshire, Indiana, and Florida pages block scripts or render with JavaScript, so their rights, deadlines, and dates were confirmed from the statute sections as quoted by other sources and from the Texas, Utah, and California agency pages.
- Alabama, Louisiana, and Vermont (S.71) were enacted in 2026 and their enrolled text was not readable.
  Their dates and signing came from the legislature's bill pages, and their 45 day deadlines and rights from law firm summaries.
  Re-read them against the enrolled text before relying on the section numbers.
- Connecticut's 2025 amendments (2026-07-01), Montana's 2025 amendments, Maryland's 2026 amendments, and Vermont Act 138 of 2026 (broker registration, 2027-01-01) were noted from law firm summaries.
  None changes a consumer right or deadline used here.

California's DROP: consumers could submit requests from 2026-01-01, and brokers must process them from 2026-08-01 and at least every 45 days after.
A direct request to a broker stays valid next to DROP.

## Tests

`pnpm --filter @kickrocks/legal test` runs the data checks (every statute has a primary source URL and a valid effective date), the basis rules, the identifier rules, and a snapshot of every email for all 51 jurisdictions, three kinds, and three right sets, plus the 2026 laws once they take effect and the target variants.
Review `src/__snapshots__/email.test.ts.snap` whenever a template or statute changes.
