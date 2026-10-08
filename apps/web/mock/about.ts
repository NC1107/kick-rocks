import { API_ROUTES, DATA_SOURCE_DETAILS, DataSourceId } from "@kickrocks/shared";
import { defineMockDomain, handle } from "./core.js";

/** What the About page reads: the server's version and counts, and where the data comes from. */
export default defineMockDomain({
  name: "about",

  routes: (store) => [
    handle(API_ROUTES.health, () => ({
      ok: true,
      version: "0.1.0-mock",
      scheduler: { lastPassAt: null },
      database: { writable: true },
      disk: { freeBytes: null },
    })),

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
