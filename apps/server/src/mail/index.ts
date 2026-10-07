import type { Config } from "../config.js";
import type { SettingsStore } from "../core/settings.js";
import { createReplyClassifier } from "./classifier.js";
import { createInboxSource } from "./inbox.js";
import { createLinkFollower, type HostResolver } from "./link-follower.js";
import type { LlmFetch } from "./llm.js";
import { createMailTransport } from "./transport.js";
import type { MailServices } from "./types.js";

export { MailFetchError } from "./inbox.js";
export { findProviderPreset, PROVIDER_PRESETS } from "./presets.js";
export { InvalidOutgoingMailError, MailSendError } from "./transport.js";
export type * from "./types.js";

/** Replacements for the network, so a test can point the mail services at local fixtures. */
export interface MailServiceDeps {
  /** Used for the language model fallback. */
  fetch?: LlmFetch;
  /** Used by the link follower to find a host's addresses. */
  resolve?: HostResolver;
}

/**
 * Builds the mail services: SMTP sending, IMAP reading, reply classification, and link following.
 * `settings` is how the classifier finds the configured language model, read on every message so
 * a change in settings applies without a restart.
 */
export function createMailServices(
  config: Config,
  settings: SettingsStore,
  deps: MailServiceDeps = {},
): MailServices {
  return {
    transport: createMailTransport,
    inbox: createInboxSource,
    classifier: createReplyClassifier({
      settings,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    }),
    linkFollower: createLinkFollower({
      allowedPrivateHosts: config.linkFollower.allowedPrivateHosts,
      ...(deps.resolve ? { resolve: deps.resolve } : {}),
    }),
  };
}
