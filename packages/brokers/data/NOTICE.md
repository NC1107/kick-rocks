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
| `upstream/ca-registry-2025.csv` | Pinned copy of the California registry export | Public record |

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

## Eraser broker list

Source: the Eraser project's broker list, copied to `upstream/eraser-brokers.yaml`.
License: MIT.
The license text is `upstream/ERASER-LICENSE`.

## California Data Broker Registry

Source: the California Privacy Protection Agency data broker registry export, copied to `upstream/ca-registry-2025.csv`.
License: public record published by a state agency.
The registry contributes the broker name, contacts, regulatory flags, and the 2023 request metrics.

## Merge order

Records are merged by domain in this order: BADBOOL, Eraser, the California registry, then the hand-written broker records.
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
The other state registries have no structured download that a person without an account can fetch, as of 2026-10-07.

- Vermont: the Secretary of State offers a bulk database download only after logging in to its business services site.
  An amendment requires a public downloadable list from 2027-01-01, so check again then.
- Texas: the Secretary of State registry is a search portal rendered in the browser, and the Attorney General and Secretary of State pages link to no CSV, spreadsheet, or API.
- Oregon: the Department of Consumer and Business Services lists data brokers through its license search page, which has no download.

Scraping a search page is not an import.
It would break whenever the page changed and would copy records whose terms of reuse are not stated.
When one of these states publishes a download, add an importer next to `src/import/ca-registry.ts` and put it after the California registry in `src/build.ts`.
