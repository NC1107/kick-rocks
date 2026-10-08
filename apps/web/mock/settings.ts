import {
  API_ROUTES,
  type Jurisdiction,
  Recipe,
  type RecipeHealth,
  type RecipePurpose,
  type RecipeRecord,
  type RecipeSource,
  type RecipeStatus,
  type SettingsView,
  type TargetDetail,
} from "@kickrocks/shared";
import { conflict, defineMockDomain, handle, notFound } from "./core.js";
import { notificationRoutes } from "./notifications.js";
import { freshMockNotifications, type MockStore } from "./store.js";

function hex(store: MockStore, length: number): string {
  return Array.from({ length }, () => Math.floor(store.random() * 16).toString(16)).join("");
}

function recipeInput(target: TargetDetail, purpose: RecipePurpose, version: number) {
  const base = {
    id: `${target.id}.${purpose}.v${version}`,
    brokerId: target.id,
    version,
    purpose,
    notes: null,
    verifiedAt: "2026-09-20",
    liveStatus: "verified" as const,
  };
  const canary = {
    url: `https://www.${target.domain}/privacy/opt-out`,
    selectors: [{ role: "button", label: "Submit" }],
  };
  if (purpose === "scan") {
    return {
      ...base,
      entryUrl: `https://www.${target.domain}/search`,
      fields: ["full_name", "state"],
      steps: [
        {
          kind: "goto",
          url: `https://www.${target.domain}/search?name={{full_name|urlencode}}&state={{state}}`,
        },
        { kind: "wait_for", target: { css: ".results" } },
        {
          kind: "extract_candidates",
          item: { css: ".result-card" },
          fields: {
            recordUrl: { css: "a.profile", attr: "href" },
            name: { css: ".name" },
            age: { css: ".age" },
            locations: { css: ".location", all: true },
          },
        },
      ],
      canary: {
        url: `https://www.${target.domain}/search`,
        selectors: [{ css: "form[role=search]" }],
      },
    };
  }
  return {
    ...base,
    entryUrl: `https://www.${target.domain}/privacy/opt-out`,
    fields: ["full_name", "email", "record_url"],
    steps: [
      { kind: "goto", url: `https://www.${target.domain}/remove?record={{record_url|urlencode}}` },
      { kind: "click", target: { role: "link", label: "Remove this record" } },
      { kind: "fill", target: { label: "Email address" }, field: "email" },
      { kind: "captcha_checkpoint" },
      { kind: "click", target: { role: "button", label: "Submit" } },
      { kind: "expect_text", text: "request received" },
    ],
    canary,
  };
}

function seedRecipe(
  store: MockStore,
  targetId: string,
  purpose: RecipePurpose,
  fields: {
    source?: RecipeSource;
    status?: RecipeStatus;
    health?: RecipeHealth;
    failureCount?: number;
    notes?: string;
    liveStatus?: Recipe["liveStatus"];
    createdDaysAgo?: number;
  } = {},
): void {
  const target = store.targets.find((candidate) => candidate.id === targetId);
  if (!target) return;
  const definition = Recipe.parse({
    ...recipeInput(target, purpose, 1),
    ...(fields.liveStatus ? { liveStatus: fields.liveStatus, verifiedAt: "2026-10-07" } : {}),
  });
  const record: RecipeRecord = {
    id: definition.id,
    targetId,
    targetName: target.name,
    purpose,
    version: 1,
    source: fields.source ?? "bundled",
    status: fields.status ?? "active",
    health: fields.health ?? "healthy",
    failureCount: fields.failureCount ?? 0,
    lastCheckedAt: fields.health === "unknown" ? null : store.ago({ days: 2 }),
    notes: fields.notes ?? null,
    createdAt: store.ago({ days: fields.createdDaysAgo ?? 60 }),
    definition,
  };
  store.recipes.push(record);
}

/** Real statute names, with placeholder links: this is a fixture, not a legal reference. */
const JURISDICTIONS: Jurisdiction[] = [
  {
    state: "CA",
    statutes: [
      {
        id: "ca-ccpa",
        state: "CA",
        kind: "comprehensive",
        name: "California Consumer Privacy Act",
        citation: "Cal. Civ. Code 1798.100 and following",
        effectiveDate: "2020-01-01",
        rights: ["opt_out", "delete"],
        responseDays: 45,
        extensionDays: 45,
        brokerNotes: null,
        platform: null,
        sourceUrl: "https://example.org/law/ca-ccpa",
        notes: null,
      },
      {
        id: "ca-delete-act",
        state: "CA",
        kind: "data_broker",
        name: "California Delete Act",
        citation: "Cal. Civ. Code 1798.99.80 and following",
        effectiveDate: "2024-01-01",
        rights: ["delete"],
        responseDays: 45,
        extensionDays: 0,
        brokerNotes:
          "Registered brokers must honor deletion requests made through the state platform.",
        platform: {
          name: "DROP",
          url: "https://example.org/drop",
          note: "One request reaches every registered broker. Prefer it for California residents.",
        },
        sourceUrl: "https://example.org/law/ca-delete-act",
        notes: null,
      },
    ],
  },
  {
    state: "CO",
    statutes: [
      {
        id: "co-cpa",
        state: "CO",
        kind: "comprehensive",
        name: "Colorado Privacy Act",
        citation: "C.R.S. 6-1-1301 and following",
        effectiveDate: "2023-07-01",
        rights: ["opt_out", "delete"],
        responseDays: 45,
        extensionDays: 45,
        brokerNotes: null,
        platform: null,
        sourceUrl: "https://example.org/law/co-cpa",
        notes: null,
      },
    ],
  },
  {
    state: "TX",
    statutes: [
      {
        id: "tx-tdpsa",
        state: "TX",
        kind: "comprehensive",
        name: "Texas Data Privacy and Security Act",
        citation: "Tex. Bus. & Com. Code ch. 541",
        effectiveDate: "2024-07-01",
        rights: ["opt_out", "delete"],
        responseDays: 45,
        extensionDays: 45,
        brokerNotes: null,
        platform: null,
        sourceUrl: "https://example.org/law/tx-tdpsa",
        notes: null,
      },
    ],
  },
  {
    state: "VA",
    statutes: [
      {
        id: "va-vcdpa",
        state: "VA",
        kind: "comprehensive",
        name: "Virginia Consumer Data Protection Act",
        citation: "Va. Code 59.1-575 and following",
        effectiveDate: "2023-01-01",
        rights: ["opt_out", "delete"],
        responseDays: 45,
        extensionDays: 45,
        brokerNotes: null,
        platform: null,
        sourceUrl: "https://example.org/law/va-vcdpa",
        notes: null,
      },
    ],
  },
];

const DEFAULT_SCHEDULE = {
  pollMinutes: 15,
  peopleSearchRescanDays: 60,
  brokerRescanDays: 90,
  noResponseDays: 45,
  maxFollowUps: 2,
};

function wipePersonalData(store: MockStore): void {
  store.profiles = [];
  store.requests = [];
  store.messages = [];
  store.tasks = store.tasks.filter((task) => task.kind === "canary");
  store.matches = [];
  store.scans = [];
  for (const id of store.blockedInfo.keys()) {
    if (!store.tasks.some((task) => task.id === id)) store.blockedInfo.delete(id);
  }
}

const KEEP_ALIVE_MS = 10 * 60 * 1000;

export default defineMockDomain({
  name: "settings",

  seed(store) {
    store.settings = {
      ...store.settings,
      worker: {
        enabled: true,
        builtin: {
          workerId: "worker-home",
          version: "0.1.0",
          lastSeenAt: store.ago({ minutes: 1 }),
          busy: false,
          currentTaskId: null,
        },
        // No agent has connected, so form-only targets wait for a person, as the campaign preview warns.
        model: null,
      },
    };
    seedRecipe(store, "peopletrace", "scan");
    seedRecipe(store, "peopletrace", "remove");
    seedRecipe(store, "namelookup", "scan");
    seedRecipe(store, "findrecord", "remove", {
      health: "broken",
      failureCount: 3,
      notes: "Third failure in a row: the submit button moved.",
    });
    seedRecipe(store, "findrecord", "scan");
    seedRecipe(store, "cityfile-directory", "scan", { health: "unknown" });
    seedRecipe(store, "cardinal-insights", "remove", {
      status: "pending_review",
      health: "unknown",
      liveStatus: "unverified",
      notes:
        "Verified in headed Chrome: the opt-out form takes a profile URL and an email address and shows no captcha. Submission and the page after it were not exercised, so the wording that proves the request went through is a guess.",
      createdDaysAgo: 5,
    });
    seedRecipe(store, "brightlist", "scan", {
      status: "pending_review",
      health: "unknown",
      liveStatus: "blocked_by_bot_protection",
      notes: "Headless Chrome got a 403 and the search page was never read.",
      createdDaysAgo: 5,
    });
    seedRecipe(store, "locata", "remove", {
      source: "proposed",
      status: "pending_review",
      health: "unknown",
      notes: "Proposed by an agent after the bundled steps could not find the form.",
      createdDaysAgo: 1,
    });
    seedRecipe(store, "kinsearch", "remove", {
      source: "proposed",
      status: "pending_review",
      health: "unknown",
      notes: "Adds a step for the account login screen.",
      createdDaysAgo: 3,
    });
  },

  routes: (store) => {
    const recipeOf = (id: string) => {
      const recipe = store.recipes.find((candidate) => candidate.id === id);
      if (!recipe) throw notFound("That recipe");
      return recipe;
    };
    const decide = (id: string, status: "active" | "rejected") => {
      const recipe = recipeOf(id);
      if (
        recipe.status !== "pending_review" &&
        !(status === "active" && recipe.status === "rejected")
      )
        throw conflict("Only a recipe waiting for review can be decided.");
      recipe.status = status;
      const target = store.targets.find((candidate) => candidate.id === recipe.targetId);
      const listed = target?.recipes.find((candidate) => candidate.id === recipe.id);
      if (listed) listed.status = status;
      return recipe;
    };

    return [
      ...notificationRoutes(store),

      handle(API_ROUTES.settingsGet, (): SettingsView => {
        const now = store.clock.now().getTime();
        // A worker seen in the last few minutes keeps checking in, so the fixture stays online
        // however long the session runs. One a test or a walk has set further back stays down.
        const checkIn = <T extends { lastSeenAt: string }>(worker: T | null): T | null =>
          worker && now - Date.parse(worker.lastSeenAt) < KEEP_ALIVE_MS
            ? { ...worker, lastSeenAt: new Date(now - 30_000).toISOString() }
            : worker;
        const { worker } = store.settings;
        return {
          ...store.settings,
          worker: { ...worker, builtin: checkIn(worker.builtin), model: checkIn(worker.model) },
        };
      }),

      handle(API_ROUTES.settingsPatch, ({ body }): SettingsView => {
        const current = store.settings;
        if (body.schedule) {
          const patch = Object.fromEntries(
            Object.entries(body.schedule).filter(([, value]) => value !== undefined),
          );
          current.schedule = { ...current.schedule, ...patch };
        }
        if (body.retention) {
          const patch = Object.fromEntries(
            Object.entries(body.retention).filter(([, value]) => value !== undefined),
          );
          current.retention = { ...current.retention, ...patch };
        }
        if (body.llm === null) current.llm = null;
        else if (body.llm) {
          current.llm = {
            baseUrl: body.llm.baseUrl,
            model: body.llm.model,
            apiKeySet: body.llm.apiKey ? true : (current.llm?.apiKeySet ?? false),
          };
        }
        if (body.mcp) current.mcp = { ...current.mcp, enabled: body.mcp.enabled };
        if (body.siteChecks) current.siteChecks = { enabled: body.siteChecks.enabled };
        if (body.agent) current.agent = { takeUnreviewed: body.agent.takeUnreviewed };
        return current;
      }),

      handle(API_ROUTES.settingsReset, () => {
        wipePersonalData(store);
        store.settings = {
          ...store.settings,
          schedule: { ...DEFAULT_SCHEDULE },
          llm: null,
          agent: { takeUnreviewed: false },
          retention: { messageDays: null, screenshotDays: 30 },
          mcp: { ...store.settings.mcp, enabled: false, tokenSet: false },
          siteChecks: { enabled: false },
        };
        store.mcpToken = null;
        store.notifications = freshMockNotifications();
        return { ok: true as const };
      }),

      handle(API_ROUTES.settingsMcpToken, () => {
        const token = `krmcp_${hex(store, 40)}`;
        store.mcpToken = token;
        store.settings.mcp = { ...store.settings.mcp, tokenSet: true };
        return { token };
      }),

      handle(API_ROUTES.settingsJurisdictions, () => ({ jurisdictions: JURISDICTIONS })),

      handle(API_ROUTES.recipesList, ({ query }) => ({
        recipes: store.recipes.filter(
          (recipe) =>
            (query.status ? recipe.status === query.status : true) &&
            (query.source ? recipe.source === query.source : true),
        ),
      })),
      handle(API_ROUTES.recipesApprove, ({ params }) => decide(params.id, "active")),
      handle(API_ROUTES.recipesReject, ({ params }) => decide(params.id, "rejected")),
    ];
  },
});
