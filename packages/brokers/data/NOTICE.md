# Data notices

Kick Rocks bundles data from several sources.
Each source keeps its own license, and every generated record names its source and license in `sources`.

## Licenses at a glance

| File | Content | License |
|---|---|---|
| `generated/brokers.json` | Merge of every broker source below | CC BY-NC-SA 4.0, because of BADBOOL's ShareAlike clause |
| `companies.json` | Hand-curated consumer company contacts | PolyForm Noncommercial 1.0.0 |
| `curated-brokers.yaml` | Hand-written broker records | PolyForm Noncommercial 1.0.0 |
| `ids.json` | Domain to broker id map | PolyForm Noncommercial 1.0.0 |
| `upstream/BADBOOL-README.md` | Pinned copy of BADBOOL | CC BY-NC-SA 4.0 |
| `upstream/eraser-brokers.yaml` | Pinned copy of the Eraser broker list | MIT |
| `upstream/optery-data-brokers.json`, `upstream/OPTERY-LICENSE.md` | Pinned copy of the Optery Data Brokers Directory | CC BY-NC-SA 4.0 |
| `upstream/ca-registry-2026.csv` | Pinned copy of the California registry export | Public record |
| `corrections.yaml`, `excluded.yaml`, `reply-domains.yaml` | Hand-checked fixes to the imported records | PolyForm Noncommercial 1.0.0 |

The code in this repository is under PolyForm Noncommercial 1.0.0.
The generated broker file is distributed under CC BY-NC-SA 4.0 and must keep the attribution below wherever it goes.

## BADBOOL

Attribution: contains data from the Big Ass Data Broker Opt-Out List (BADBOOL) by Yael Grauer.
Source: https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List, branch `master`, commit `79f63fdc8a9791246af5e10865865aff584d809b`, committed 2026-09-28.
License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-nc-sa/4.0/.
The full license text is `upstream/BADBOOL-LICENSE.md`.

Changes made: the README is parsed into structured records.
Priority and requirement markers become `priority` and `requirements`, the links become `searchUrl` and `optOutUrl`, the entry text becomes `notes` with any em dash written as a plain dash, and a few entries are given a different category than the README section implies (see `src/import/badbool.ts`).
Records are then merged with the sources below, which can fill fields BADBOOL lacks.

The pinned copy is checked against the hashes in `upstream/badbool.source.json` on every build.
To update it, replace the two files, update the commit, date, and hashes in that file, rebuild, and review the diff.

## Optery Data Brokers Directory

Attribution: contains data from the Optery Data Brokers Directory by Optery, Inc.
Source: https://github.com/optery/optery-data-brokers-directory, branch `master`, commit `b32a893b1e903d6d7961b5a526bea5f3e8a5af9e`, committed 2026-04-21, file `data/data-brokers.json`.
License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-nc-sa/4.0/.
The repository's `LICENSE.md` and its README both state this license, and the license text is `upstream/OPTERY-LICENSE.md`.

Changes made: only the name, website, opt-out link, email, and site type are read.
The site type decides the category, and the long descriptions are not copied.
An email counts only when its mailbox looks like a privacy or data-request inbox on the broker's own domain.

The pinned files are checked against the hashes in `upstream/optery.source.json` on every build.

## Eraser broker list

Source: https://github.com/drumandbytes/eraser, branch `main`, file `data/brokers.yaml`, commit `29bd7bb60a96cfb87eb84e65fd4f0a434860511e`, committed 2026-10-04, copied to `upstream/eraser-brokers.yaml`.
License: MIT.
The license text is `upstream/ERASER-LICENSE`.

The pinned files are checked against the hashes in `upstream/eraser.source.json` on every build.

## California Data Broker Registry

Source: the California Privacy Protection Agency data broker registry, https://cppa.ca.gov/data_broker_registry/, file https://cppa.ca.gov/data_broker_registry/registry.csv, retrieved 2026-10-07 and copied to `upstream/ca-registry-2026.csv`.
The page was last updated 2026-07-29.
License: public record published by a state agency.
The registry contributes the broker name, contacts, regulatory flags, and the 2024 request metrics.
The importer finds each column by its header text, and takes the metrics year from the file.

The registry lists whoever filed the form, so its contact is used as a privacy email only when the mailbox looks like a privacy or data-request inbox on the broker's own domain.
A named person, an accounting, security, or tax inbox, or a mailbox on another company's host is dropped, and the target falls back to its form or to unknown.

The pinned copy is checked against the hash in `upstream/ca-registry.source.json` on every build.
The 2025 registry (brokers that registered in January 2025) is no longer bundled.
To update, download the new export, replace the file, update the retrieval date and hash in that file, rebuild, and review the diff.

## Corrections and exclusions

An imported record always wins over a hand-written one, so `corrections.yaml` replaces fields on imported records before they merge.
Each correction names the pages it was read from and the day it was checked, and the build fails when a correction matches no record.
`excluded.yaml` drops sites that one list removed but another still carries.

## Merge order

Records are merged by domain in this order: BADBOOL, Eraser, the California registry, Optery, then the hand-written broker records.
An earlier source wins a conflict, and a later one fills fields that are empty.
Broker ids are pinned by domain in `ids.json`, so an id never changes whichever source supplies the record.

## Company list

`companies.json` lists major United States consumer companies for "stop selling my data" requests.
Every contact was read from the company's own privacy page, and the page is named in the company's `notes` with the date it was read in `verifiedAt`.
Company privacy pages change, so treat a contact as correct on that date only.

Simple Opt Out was used only as a list of company names to consider.
It has no license, so none of its text, links, or contacts were copied.

## State registries that are not imported

Only the California registry is imported.
Vermont and Texas have no structured download that a person without an account can fetch, as of 2026-10-07.

- Vermont: the Secretary of State offers a bulk database download only after logging in to its business services site.
  An amendment requires a public downloadable list from 2027-01-01, so check again then.
- Texas: the Secretary of State registry is a search portal rendered in the browser, and the Attorney General and Secretary of State pages link to no CSV, spreadsheet, or API.
- Oregon: the Department of Consumer and Business Services Division of Financial Regulation does publish two CSV reports that need no login, "Data Broker Opt Out Methods" and "Data Broker Data Collected".
  They are linked from the licensing data search at https://www4.cbs.state.or.us/exs/all/mylicsearch/index.cfm?fuseaction=main.show_main&group_id=20&profession_id=28&profession_sub_id=28000 and download from https://www4.cbs.state.or.us/ex/shared/downtemp/dfcs_db_optout.csv and https://www4.cbs.state.or.us/ex/shared/downtemp/dfcs_db_collected.csv.
  The opt-out file listed 390 brokers on 2026-10-07 with a license number, facility name, doing-business-as name, update date, opt-out email, street address, phone, website, and narrative.
  It is not imported yet.

Scraping a search page is not an import.
When a state publishes a download, add an importer next to `src/import/ca-registry.ts`, pin the file with a source file like `upstream/ca-registry.source.json`, and put it after the California registry in `src/build.ts`.
