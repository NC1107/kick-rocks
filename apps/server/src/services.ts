import {
  hasCompanyDataset,
  hasGeneratedDataset,
  loadBrokerDataset,
  loadCompanyDataset,
} from "@kickrocks/brokers";
import type { KickRocksDb } from "@kickrocks/db";
import type { LegalApi } from "@kickrocks/legal";
import * as legalExports from "@kickrocks/legal";
import type { BrokerDataset, CompanyDataset } from "@kickrocks/shared";
import type { Config } from "./config.js";
import type { AuthService } from "./core/auth.js";
import { type Clock, systemClock } from "./core/clock.js";
import { type Composer, createComposer } from "./core/composer.js";
import { createDispatch, type Dispatch } from "./core/dispatch.js";
import { createLogger, type Logger } from "./core/logger.js";
import { createMailHolds, type MailHolds } from "./core/mail-holds.js";
import { createMailQuota, type MailQuota } from "./core/mail-quota.js";
import { createRecipeHealth, type RecipeHealthService } from "./core/recipe-health.js";
import { createRequestFlow, type Requests } from "./core/request-flow.js";
import { createRequestsService } from "./core/requests.js";
import { createSecrets, type Secrets } from "./core/secrets.js";
import { createSettingsStore, type SettingsStore } from "./core/settings.js";
import { createSitePoliteness, type SitePoliteness } from "./core/site-politeness.js";
import { createStartup, type Startup } from "./core/startup.js";
import { createTargetsService, type TargetSources, type TargetsService } from "./core/targets.js";
import { registerTaskAudit } from "./core/task-audit.js";
import { createTaskHandlers, type TaskHandlers } from "./core/task-handlers.js";
import { createTaskQueue, type TaskQueue } from "./core/task-queue.js";
import { registerHandlers } from "./handlers/index.js";
import { createMailServices } from "./mail/index.js";
import type { MailServices } from "./mail/types.js";
import {
  createPasswordHasher,
  type PasswordCost,
  type PasswordHasher,
} from "./modules/auth/passwords.js";
import { createAuthService } from "./modules/auth/service.js";
import {
  createNotificationChannels,
  type NotificationChannels,
} from "./modules/notifications/channels.js";
import { registerRunners } from "./runners/index.js";

/**
 * Everything a feature needs from the rest of the server. It is built once at startup and handed
 * to modules as an argument; a module never builds or imports its own.
 */
export interface AppServices {
  config: Config;
  db: KickRocksDb;
  clock: Clock;
  logger: Logger;
  settings: SettingsStore;
  taskQueue: TaskQueue;
  /** Which browser tasks may start now, shared by the queue, the status routes, and the scheduler. */
  politeness: SitePoliteness;
  taskHandlers: TaskHandlers;
  /** Requests and their events, plus `open` and `requeue`, the two ways a request goes out. */
  requests: Requests;
  recipeHealth: RecipeHealthService;
  targets: TargetsService;
  dispatch: Dispatch;
  /** How a request becomes an email, shared by the campaign preview and the email runner. */
  composer: Composer;
  /** What each mailbox has sent, shared by the daily cap, the pacing, and the dashboard. */
  mailQuota: MailQuota;
  /** Mailboxes sending is paused for, shared by the email runner and the mailbox settings. */
  mailHolds: MailHolds;
  /** Steps that run once after the targets are synced, in `buildApp`. */
  startup: Startup;
  secrets: Secrets;
  mail: MailServices;
  legal: LegalApi;
  auth: AuthService;
  passwords: PasswordHasher;
  /** How a push reaches ntfy or Telegram, replaced in tests with a local server. */
  notificationChannels: NotificationChannels;
}

/** Replacements for the pieces tests and tools need to control. */
export interface ServiceOverrides {
  clock?: Clock;
  /** Source of the jitter on the gap between visits to a site. Tests fix it to get exact times. */
  random?: () => number;
  logger?: Logger;
  mail?: MailServices;
  legal?: LegalApi;
  auth?: AuthService;
  notificationChannels?: NotificationChannels;
  targetSources?: TargetSources;
  /** Cheaper argon2 settings so a test that signs in many times stays fast. Never set outside tests. */
  passwordCost?: PasswordCost;
}

/** Where the dataset files are read from, so a test can say what is and is not on disk. */
export interface DatasetFiles {
  hasBrokers(): boolean;
  loadBrokers(): BrokerDataset;
  hasCompanies(): boolean;
  loadCompanies(): CompanyDataset;
}

const diskDatasets: DatasetFiles = {
  hasBrokers: hasGeneratedDataset,
  loadBrokers: loadBrokerDataset,
  hasCompanies: hasCompanyDataset,
  loadCompanies: loadCompanyDataset,
};

export function datasetSources(files: DatasetFiles = diskDatasets): TargetSources {
  return {
    brokers() {
      if (!files.hasBrokers()) return null;
      const dataset = files.loadBrokers();
      return { version: dataset.generatedAt, records: dataset.brokers };
    },
    companies() {
      // An absent file must read as unavailable, or a sync would retire every company.
      if (!files.hasCompanies()) return null;
      const dataset = files.loadCompanies();
      return { version: dataset.generatedAt, records: dataset.companies };
    },
  };
}

export function createServices(
  config: Config,
  db: KickRocksDb,
  overrides: ServiceOverrides = {},
): AppServices {
  const clock = overrides.clock ?? systemClock;
  const logger = overrides.logger ?? createLogger(config);
  const settings = createSettingsStore(db, clock);
  const secrets = createSecrets(config, settings);
  const taskHandlers = createTaskHandlers();
  const politeness = createSitePoliteness({
    db,
    clock,
    settings,
    ...(overrides.random ? { random: overrides.random } : {}),
  });
  const taskQueue = createTaskQueue({ db, clock, handlers: taskHandlers, politeness });
  const requestStore = createRequestsService({ db, clock, taskQueue });
  const targets = createTargetsService({
    db,
    clock,
    logger,
    sources: overrides.targetSources ?? datasetSources(),
    extraTargetsPath: config.extraTargetsPath,
  });
  const legal: LegalApi = overrides.legal ?? {
    resolveLegalBasis: legalExports.resolveLegalBasis,
    getLegalBasis: legalExports.getLegalBasis,
    recommendDrop: legalExports.recommendDrop,
    listJurisdictions: legalExports.listJurisdictions,
    identifiersFor: legalExports.identifiersFor,
    renderRequestEmail: legalExports.renderRequestEmail,
  };
  const dispatch = createDispatch({ db, clock, taskQueue, requests: requestStore, targets, legal });
  const requests: Requests = {
    ...requestStore,
    ...createRequestFlow({ db, clock, legal, requests: requestStore, targets, dispatch }),
  };
  registerTaskAudit(taskHandlers, requests);

  const services: AppServices = {
    config,
    db,
    clock,
    logger,
    settings,
    taskQueue,
    politeness,
    taskHandlers,
    requests,
    recipeHealth: createRecipeHealth(db, clock),
    targets,
    dispatch,
    composer: createComposer({ db, clock, legal, targets }),
    mailQuota: createMailQuota(db, clock),
    mailHolds: createMailHolds(clock),
    startup: createStartup(),
    secrets,
    mail: overrides.mail ?? createMailServices(config, settings),
    legal,
    passwords: createPasswordHasher(overrides.passwordCost),
    auth: overrides.auth ?? createAuthService({ config, db, clock, logger, settings, secrets }),
    notificationChannels: overrides.notificationChannels ?? createNotificationChannels(),
  };

  registerHandlers(services);
  registerRunners(services);
  return services;
}
