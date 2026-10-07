import about from "./about.js";
import auth from "./auth.js";
import campaigns from "./campaigns.js";
import type { MockDomain } from "./core.js";
import dashboard from "./dashboard.js";
import mailbox from "./mailbox.js";
import profiles from "./profiles.js";
import requests from "./requests.js";
import review from "./review.js";
import settings from "./settings.js";
import targets from "./targets.js";

/**
 * The domains, in seeding order. A domain may read what an earlier one put in the store: targets
 * need profiles to exist for nothing, but requests need both, and review needs requests.
 * Adding a route never means editing this file; add a handler to the domain that owns the page.
 */
export const MOCK_DOMAINS: readonly MockDomain[] = [
  auth,
  profiles,
  mailbox,
  targets,
  requests,
  review,
  campaigns,
  dashboard,
  settings,
  about,
];
