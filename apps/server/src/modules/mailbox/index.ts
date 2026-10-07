import { API_ROUTES, type MailboxTestResult } from "@kickrocks/shared";
import { AppError } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { requireProfile } from "../../core/require-profile.js";
import { PROVIDER_PRESETS } from "../../mail/presets.js";
import { connectionOf } from "../../runners/connection.js";
import {
  connectionForTest,
  deleteMailbox,
  findMailbox,
  requireMailbox,
  saveMailbox,
  toMailbox,
} from "./service.js";

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : "The mail server could not be reached";
}

export const mailboxModule: ModulePlugin = (app, services) => {
  registerRoute(app, API_ROUTES.mailProviders, () => ({ providers: [...PROVIDER_PRESETS] }));

  registerRoute(app, API_ROUTES.mailboxTest, async ({ params, body }) => {
    requireProfile(services.db, params.id);
    const connection = connectionForTest(body, findMailbox(services, params.id));

    // Each side is tested on its own, so a working SMTP login is still reported when IMAP fails.
    const [smtp, imap] = await Promise.all([
      services.mail.transport(connection).verify(),
      services.mail
        .inbox(connection)
        .listFolders()
        .then((folders) => ({ ok: true, error: null, folders }))
        .catch((error: unknown) => ({ ok: false, error: failureText(error), folders: [] })),
    ]);
    const result: MailboxTestResult = { smtp, imap };
    return result;
  });

  registerRoute(app, API_ROUTES.mailboxSave, ({ params, body }) => {
    requireProfile(services.db, params.id);
    return toMailbox(saveMailbox(services, params.id, body));
  });

  registerRoute(app, API_ROUTES.mailboxDelete, ({ params }) => {
    deleteMailbox(services, params.id);
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.mailboxPoll, ({ params }) => {
    const mailbox = requireMailbox(services, params.id);
    const { task } = services.dispatch.enqueueInboxPoll(mailbox.id);
    const [summary] = services.taskQueue.summarize([task]);
    if (!summary) throw new AppError(500, "internal_error", "The poll was queued but not found");
    return { task: summary };
  });

  registerRoute(app, API_ROUTES.mailboxFolders, async ({ params }) => {
    const mailbox = requireMailbox(services, params.id);
    try {
      return { folders: await services.mail.inbox(connectionOf(mailbox)).listFolders() };
    } catch (error) {
      throw new AppError(502, "mailbox_unreachable", failureText(error));
    }
  });
};
