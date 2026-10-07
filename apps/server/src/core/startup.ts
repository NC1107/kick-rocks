/**
 * Work that has to happen once, after the targets are synced and before the server answers
 * anything. A module registers a step in its plugin and `buildApp` runs the steps in order.
 *
 * The reason it exists: a recipe's target is a foreign key, so a recipe cannot be stored until its
 * target is, and a module that did it when its plugin registered would run before the first sync
 * on a fresh database and fail on every recipe.
 */
export interface Startup {
  /** Registers a step. Steps run in the order they were registered. */
  onReady(name: string, step: () => void | Promise<void>): void;
  /** Runs every step in order. A step that throws stops the server from starting, naming itself. */
  run(): Promise<void>;
}

export function createStartup(): Startup {
  const steps: Array<{ name: string; step: () => void | Promise<void> }> = [];
  return {
    onReady(name, step) {
      steps.push({ name, step });
    },
    async run() {
      for (const { name, step } of steps) {
        try {
          await step();
        } catch (error) {
          throw new Error(`Startup step "${name}" failed: ${(error as Error).message}`, {
            cause: error,
          });
        }
      }
    },
  };
}
