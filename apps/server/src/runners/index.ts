import type { AppServices } from "../services.js";
import { EmailRunner } from "./email-send.js";
import { InboxRunner } from "./inbox-poll.js";

export interface Runners {
  email: EmailRunner;
  inbox: InboxRunner;
  /** Runs every in-process task that is due, polls first because a reply can change what is sent. */
  runDue(): Promise<{ polled: number; sent: number }>;
}

interface RunnerOptions {
  /** Where the jitter between sends comes from. Tests pass a fixed one. */
  random?: () => number;
}

export function createRunners(services: AppServices, options: RunnerOptions = {}): Runners {
  const email = new EmailRunner(services, options.random ?? Math.random);
  const inbox = new InboxRunner(services);
  return {
    email,
    inbox,
    async runDue() {
      const polled = await inbox.runDue();
      const sent = await email.runDue();
      return { polled, sent };
    },
  };
}

const registered = new WeakMap<AppServices, Runners>();

/** Builds the in-process task runners (`email_send`, `inbox_poll`) for these services. */
export function registerRunners(services: AppServices): void {
  registered.set(services, createRunners(services));
}

/** The runners `registerRunners` built, which the scheduler drives. */
export function runnersOf(services: AppServices): Runners {
  const runners = registered.get(services);
  if (!runners) throw new Error("registerRunners has not run for these services");
  return runners;
}
