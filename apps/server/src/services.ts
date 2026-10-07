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
import { createDispatch, type Dispatch } from "./core/dispatch.js";
import { createLogger, type Logger } from "./core/logger.js";
import { createRecipeHealth, type RecipeHealthService } from "./core/recipe-health.js";
import { createRequestsService, type RequestsService } from "./core/requests.js";
import { createSecrets, type Secrets } from "./core/secrets.js";
import { createSettingsStore, type SettingsStore } from "./core/settings.js";
import { createTargetsService, type TargetSources, type TargetsService } from "./core/targets.js";
import { createTaskHandlers, type TaskHandlers } from "./core/task-handlers.js";
import { createTaskQueue, type TaskQueue } from "./core/task-queue.js";
import { registerHandlers } from "./handlers/index.js";
import { createMailServices } from "./mail/index.js";
import type { MailServices } from "./mail/types.js";
import { createAuthService } from "./modules/auth/service.js";
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
  taskHandlers: TaskHandlers;
  requests: RequestsService;
  recipeHealth: RecipeHealthService;
  targets: TargetsService;
  dispatch: Dispatch;
  secrets: Secrets;
  mail: MailServices;
  legal: LegalApi;
  auth: AuthService;
}

/** Replacements for the pieces tests and tools need to control. */
export interface ServiceOverrides {
  clock?: Clock;
  logger?: Logger;
  mail?: MailServices;
  legal?: LegalApi;
  auth?: AuthService;
  targetSources?: TargetSources;
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
  const taskHandlers = createTaskHandlers(logger);
  const taskQueue = createTaskQueue({ db, clock, handlers: taskHandlers });
  const requests = createRequestsService({ db, clock });
  const targets = createTargetsService({
    db,
    clock,
    logger,
    sources: overrides.targetSources ?? datasetSources(),
    extraTargetsPath: config.extraTargetsPath,
  });
  const dispatch = createDispatch({ db, clock, taskQueue, requests, targets });

  const services: AppServices = {
    config,
    db,
    clock,
    logger,
    settings,
    taskQueue,
    taskHandlers,
    requests,
    recipeHealth: createRecipeHealth(db, clock),
    targets,
    dispatch,
    secrets,
    mail: overrides.mail ?? createMailServices(config, settings),
    legal: overrides.legal ?? {
      resolveLegalBasis: legalExports.resolveLegalBasis,
      listJurisdictions: legalExports.listJurisdictions,
      identifiersFor: legalExports.identifiersFor,
      renderRequestEmail: legalExports.renderRequestEmail,
    },
    auth: overrides.auth ?? createAuthService({ config, db, clock, logger, settings, secrets }),
  };

  registerHandlers(services);
  registerRunners(services);
  return services;
}
