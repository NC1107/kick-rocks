import type { Scenario } from "../scenarios.js";
import { HISTORIES } from "./histories.js";
import { PAGING } from "./paging.js";
import { TABLES_AND_LISTS } from "./tables-and-lists.js";

/** Scans 301 to 312, written without sight of how the worker compares a record, so they test whether its checks generalize. */
export const INDEPENDENT_SCAN_SCENARIOS: Scenario[] = [
  ...TABLES_AND_LISTS,
  ...HISTORIES,
  ...PAGING,
];
