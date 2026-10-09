import { API_ROUTES, DATA_SOURCE_DETAILS, DataSourceId } from "@kickrocks/shared";
import { defineMockDomain, handle, MockReply } from "./core.js";

/** What the About page reads: the server's version and counts, and where the data comes from. */
export default defineMockDomain({
  name: "about",

  routes: (store) => [
    handle(API_ROUTES.health, ({ store: { health } }) => {
      const body = { ok: health === "ok", version: "0.1.0-mock" };
      return body.ok ? body : new MockReply(503, body);
    }),

    handle(API_ROUTES.status, () => ({
      profiles: store.profiles.length,
      brokers: {
        available: true,
        total: store.targets.filter((target) => target.kind === "broker").length,
        generatedAt: store.ago({ days: 6 }),
      },
      targets: {
        brokers: store.targets.filter((target) => target.kind === "broker").length,
        companies: store.targets.filter((target) => target.kind === "company").length,
      },
      health: {
        scheduler: {
          lastPassAt: store.ago({ minutes: store.health === "scheduler" ? 42 : 1 }),
          stalled: store.health === "scheduler",
          sendingSince: store.health === "sending" ? store.ago({ minutes: 19 }) : null,
          sendingStalled: store.health === "sending",
        },
        database: { writable: store.health !== "database" },
        disk: {
          freeBytes: store.health === "disk" ? 18 * 1024 * 1024 : 41 * 1024 ** 3,
          low: store.health === "disk",
        },
        backup: { lastVerifiedAt: store.ago({ hours: 5 }), stale: false },
      },
    })),

    handle(API_ROUTES.settingsDataSources, () => ({
      sources: DataSourceId.options.map((id) => ({
        id,
        ...DATA_SOURCE_DETAILS[id],
        targetCount: store.targets.filter((target) =>
          target.sources.some((source) => source.source === id),
        ).length,
      })),
    })),
  ],
});
