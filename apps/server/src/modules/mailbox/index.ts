import type { MailboxRow, MessageRow } from "@kickrocks/db";
import { API_ROUTES, type MailboxTestResult } from "@kickrocks/shared";
import { AppError } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { requireProfile } from "../../core/require-profile.js";
import { PROVIDER_PRESETS } from "../../mail/presets.js";
import { connectionOf } from "../../runners/connection.js";
import { InboxRunner } from "../../runners/inbox-poll.js";
import {
  confirmCleanup,
  keepStoredMail,
  listIgnored,
  previewCleanup,
  takeInIgnored,
} from "../../runners/intake-cleanup.js";
import {
  dismissShadow,
  forgetShadowLine,
  readShadow,
  requireShadowLine,
} from "../../runners/intake-shadow.js";
import { toMessageSummary } from "../review/mappers.js";
import {
  addIntakeSender,
  disableReplyAlias,
  enableReplyAlias,
  listIntakeSenders,
  removeIntakeSender,
  setCompanyMail,
} from "./intake.js";
import { findPoll, startManualPoll } from "./poll.js";
import {
  clearSendHold,
  connectionForTest,
  deleteMailbox,
  findMailbox,
  requireMailbox,
  sameDestination,
  saveMailbox,
  toMailbox,
} from "./service.js";

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : "The mail server could not be reached";
}

export const mailboxModule: ModulePlugin = (app, services) => {
  async function takeInMessage(
    mailbox: MailboxRow,
    message: { uid: number; uidValidity: number },
  ): Promise<MessageRow> {
    let row: MessageRow | null;
    try {
      row = await new InboxRunner(services).takeIn(mailbox, message);
    } catch (error) {
      throw new AppError(502, "mailbox_unreachable", failureText(error));
    }
    if (!row) {
      throw new AppError(
        409,
        "message_gone",
        "That message is no longer in the folder, so search again",
      );
    }
    return row;
  }

  registerRoute(app, API_ROUTES.mailProviders, () => ({ providers: [...PROVIDER_PRESETS] }));

  registerRoute(app, API_ROUTES.mailboxTest, async ({ params, body }) => {
    requireProfile(services.db, params.id);
    const stored = findMailbox(services, params.id);
    const connection = connectionForTest(body, stored);

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
    // Both sides answering for the saved servers is the proof the pause was waiting for.
    if (stored && smtp.ok && imap.ok && sameDestination(stored, body)) {
      clearSendHold(services, stored);
    }
    return result;
  });

  registerRoute(app, API_ROUTES.mailboxSave, ({ params, body }) => {
    requireProfile(services.db, params.id);
    const saved = saveMailbox(services, params.id, body);
    return toMailbox(saved, services.mailHolds.until(saved.id));
  });

  registerRoute(app, API_ROUTES.mailboxDelete, ({ params }) => {
    deleteMailbox(services, params.id);
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.mailboxPoll, ({ params, body }) =>
    startManualPoll(services, requireMailbox(services, params.id), body?.requestId),
  );

  registerRoute(app, API_ROUTES.mailboxPollGet, ({ params }) =>
    findPoll(services, requireMailbox(services, params.id), params.taskId),
  );

  registerRoute(app, API_ROUTES.mailboxIntake, ({ params, body }) =>
    setCompanyMail(services, requireMailbox(services, params.id), body.companyMail),
  );

  registerRoute(app, API_ROUTES.intakeCleanup, ({ params }) => {
    const mailbox = requireMailbox(services, params.id);
    return previewCleanup(services, mailbox, new InboxRunner(services).intake(mailbox));
  });

  registerRoute(app, API_ROUTES.intakeCleanupConfirm, ({ params }) => {
    const mailbox = requireMailbox(services, params.id);
    const removed = confirmCleanup(services, mailbox, new InboxRunner(services).intake(mailbox));
    return { removed };
  });

  registerRoute(app, API_ROUTES.intakeCleanupKeep, ({ params }) => {
    keepStoredMail(services, requireMailbox(services, params.id));
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.intakeIgnored, ({ params }) =>
    listIgnored(services, requireMailbox(services, params.id)),
  );

  registerRoute(app, API_ROUTES.intakeIgnoredTakeIn, ({ params }) =>
    toMessageSummary(
      takeInIgnored(services, requireMailbox(services, params.id), params.messageId),
    ),
  );

  registerRoute(app, API_ROUTES.intakeShadow, ({ params }) =>
    readShadow(services, requireMailbox(services, params.id)),
  );

  registerRoute(app, API_ROUTES.intakeShadowDismiss, ({ params }) => {
    dismissShadow(services, requireMailbox(services, params.id));
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.intakeShadowTakeIn, async ({ params }) => {
    const mailbox = requireMailbox(services, params.id);
    const line = requireShadowLine(services, mailbox, params.shadowId);
    try {
      const row = await takeInMessage(mailbox, {
        uid: line.imapUid,
        uidValidity: line.uidValidity,
      });
      return toMessageSummary(row);
    } catch (error) {
      // A message that is gone from the mailbox can never be taken in, so it leaves the list.
      if (error instanceof AppError && error.code === "message_gone") {
        forgetShadowLine(services, line.id);
      }
      throw error;
    }
  });

  registerRoute(app, API_ROUTES.mailboxAliasEnable, ({ params }) =>
    enableReplyAlias(services, requireMailbox(services, params.id)),
  );

  registerRoute(app, API_ROUTES.mailboxAliasDisable, ({ params }) =>
    disableReplyAlias(services, requireMailbox(services, params.id)),
  );

  registerRoute(app, API_ROUTES.intakeSendersList, ({ params }) => ({
    senders: listIntakeSenders(services, requireMailbox(services, params.id)),
  }));

  registerRoute(app, API_ROUTES.intakeSenderAdd, ({ params, body }) =>
    addIntakeSender(services, requireMailbox(services, params.id), body),
  );

  registerRoute(app, API_ROUTES.intakeSenderRemove, ({ params }) => {
    removeIntakeSender(services, requireMailbox(services, params.id), params.senderId);
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.mailboxFind, async ({ params, body }) => {
    const mailbox = requireMailbox(services, params.id);
    try {
      return await new InboxRunner(services).find(mailbox, body);
    } catch (error) {
      throw new AppError(502, "mailbox_unreachable", failureText(error));
    }
  });

  registerRoute(app, API_ROUTES.mailboxTakeIn, async ({ params, body }) => {
    const mailbox = requireMailbox(services, params.id);
    return toMessageSummary(await takeInMessage(mailbox, body));
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
