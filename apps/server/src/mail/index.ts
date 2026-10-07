import { NotImplementedError } from "@kickrocks/shared";
import type { Config } from "../config.js";
import type { SettingsStore } from "../core/settings.js";
import type { MailServices } from "./types.js";

export type * from "./types.js";

/**
 * Builds the mail services. The stubs reject with NotImplementedError until module B replaces
 * them; `settings` is how the classifier will find the configured LLM.
 */
export function createMailServices(_config: Config, _settings: SettingsStore): MailServices {
  const unavailable = (what: string) => () => Promise.reject(new NotImplementedError(what));
  return {
    transport: () => ({
      verify: unavailable("MailTransport.verify"),
      send: unavailable("MailTransport.send"),
    }),
    inbox: () => ({
      listFolders: unavailable("InboxSource.listFolders"),
      fetchSince: unavailable("InboxSource.fetchSince"),
    }),
    classifier: { classify: unavailable("ReplyClassifier.classify") },
    linkFollower: { follow: unavailable("LinkFollower.follow") },
  };
}
