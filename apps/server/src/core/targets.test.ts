import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { targets } from "@kickrocks/db";
import { API_ROUTES, type Broker, type Company, TargetDetail } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { datasetSources } from "../services.js";
import { makeBroker, makeCompany } from "../test-utils/builders.js";
import { createTestContext, type TestContext } from "../test-utils/index.js";
import {
  createTargetsService,
  type DatasetSnapshot,
  replyDomainsOfRow,
  type TargetsService,
} from "./targets.js";

let ctx: TestContext;
let dir: string;

beforeEach(async () => {
  ctx = await createTestContext();
  dir = mkdtempSync(join(tmpdir(), "kickrocks-extra-"));
});

afterEach(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Sources {
  brokers: DatasetSnapshot<Broker> | null;
  companies: DatasetSnapshot<Company> | null;
}

function service(sources: Sources, extraTargetsPath: string | null = null): TargetsService {
  return createTargetsService({
    db: ctx.services.db,
    clock: ctx.clock,
    logger: ctx.services.logger,
    sources: { brokers: () => sources.brokers, companies: () => sources.companies },
    extraTargetsPath,
  });
}

const brokers = (records: Broker[], version = "v1"): DatasetSnapshot<Broker> => ({
  version,
  records,
});
const companies = (records: Company[], version = "c1"): DatasetSnapshot<Company> => ({
  version,
  records,
});
const rows = () => ctx.services.db.select().from(targets).all();

function writeExtra(content: unknown): string {
  const path = join(dir, "extra.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

describe("sync", () => {
  it("inserts brokers and companies with their dataset versions", () => {
    const result = service({
      brokers: brokers([makeBroker({ id: "b1" }), makeBroker({ id: "b2" })]),
      companies: companies([makeCompany({ id: "c1" })]),
    }).sync();
    expect(result).toEqual({ added: 3, updated: 0, retired: 0, lostEmail: [], total: 3 });
    expect(
      rows()
        .map((r) => [r.id, r.kind, r.datasetVersion, r.retired])
        .sort(),
    ).toEqual([
      ["b1", "broker", "v1", false],
      ["b2", "broker", "v1", false],
      ["c1", "company", "c1", false],
    ]);
  });

  it("maps broker columns and keeps the full record", () => {
    const broker = makeBroker({
      id: "spokeo",
      category: "people-search",
      searchUrl: "https://spokeo.test/search",
      requirements: ["record_url", "captcha"],
      priority: "crucial",
      requiresId: false,
      contactMethod: "form",
      privacyEmail: null,
    });
    service({ brokers: brokers([broker]), companies: null }).sync();
    const [row] = rows();
    expect(row).toMatchObject({
      name: broker.name,
      category: "people-search",
      domain: broker.domain,
      website: broker.website,
      optOutUrl: broker.optOutUrl,
      searchUrl: "https://spokeo.test/search",
      contactMethod: "form",
      region: "us",
      requirements: ["record_url", "captcha"],
      priority: "crucial",
      privacyEmail: null,
    });
    expect(row?.data).toEqual(broker);
  });

  it("maps company columns with the defaults a company has", () => {
    const company = makeCompany({ id: "shop", domain: "shop.test", category: "retail" });
    service({ brokers: null, companies: companies([company]) }).sync();
    expect(rows()[0]).toMatchObject({
      kind: "company",
      category: "retail",
      website: "https://shop.test",
      searchUrl: null,
      region: "us",
      requiresId: false,
      requirements: [],
      priority: "normal",
      privacyEmail: company.privacyEmail,
    });
  });

  it("changes nothing when run again", () => {
    const sources = {
      brokers: brokers([makeBroker({ id: "b1" })]),
      companies: companies([makeCompany({ id: "c1" })]),
    };
    const targetsService = service(sources);
    targetsService.sync();
    const before = rows();
    expect(targetsService.sync()).toEqual({
      added: 0,
      updated: 0,
      retired: 0,
      lostEmail: [],
      total: 2,
    });
    expect(rows()).toEqual(before);
  });

  it("updates a record that changed or got a new dataset version", () => {
    const targetsService = service({
      brokers: brokers([makeBroker({ id: "b1", name: "Old" })]),
      companies: null,
    });
    targetsService.sync();
    const sources = {
      brokers: brokers([makeBroker({ id: "b1", name: "New" })], "v2"),
      companies: null,
    };
    expect(service(sources).sync()).toMatchObject({ added: 0, updated: 1 });
    expect(rows()[0]).toMatchObject({ name: "New", datasetVersion: "v2" });
    expect(
      service({
        brokers: brokers([makeBroker({ id: "b1", name: "New" })], "v3"),
        companies: null,
      }).sync().updated,
    ).toBe(1);
  });

  it("retires targets that vanished instead of deleting them", () => {
    service({
      brokers: brokers([makeBroker({ id: "keep" }), makeBroker({ id: "gone" })]),
      companies: null,
    }).sync();
    const result = service({
      brokers: brokers([makeBroker({ id: "keep" })]),
      companies: null,
    }).sync();
    expect(result.retired).toBe(1);
    expect(rows().find((r) => r.id === "gone")?.retired).toBe(true);
    expect(rows().find((r) => r.id === "keep")?.retired).toBe(false);
  });

  it("reports a target whose update took its email address away, and not one that gained or kept one", () => {
    const withEmail = (id: string, privacyEmail: string | null) =>
      makeBroker({ id, domain: `${id}.example`, privacyEmail });
    service({
      brokers: brokers([
        withEmail("loses", "a@loses.example"),
        withEmail("keeps", "a@keeps.example"),
      ]),
      companies: null,
    }).sync();
    const result = service({
      brokers: brokers([withEmail("loses", null), withEmail("keeps", "b@keeps.example")], "v2"),
      companies: null,
    }).sync();
    expect(result.lostEmail).toEqual(["loses"]);
  });

  it("keeps the detail of a target retired from the 2025 registry readable", async () => {
    const only2025 = makeBroker({
      id: "audiencepoint-inc",
      sources: [{ source: "ca-registry-2025", license: "public-record" }],
    });
    service({ brokers: brokers([only2025, makeBroker({ id: "keep" })]), companies: null }).sync();
    service({ brokers: brokers([makeBroker({ id: "keep" })], "v2"), companies: null }).sync();

    const result = await ctx.call(API_ROUTES.targetsGet, { params: { id: "audiencepoint-inc" } });
    if (!result.ok) throw new Error("the retired target has no detail");
    expect(result.body).toMatchObject({ retired: true, californiaRegistered: true });
    expect(TargetDetail.safeParse(result.body).success).toBe(true);
  });

  it("brings a retired target back when it returns", () => {
    const record = makeBroker({ id: "b1" });
    service({ brokers: brokers([record]), companies: null }).sync();
    service({ brokers: brokers([]), companies: null }).sync();
    expect(rows()[0]?.retired).toBe(true);
    const result = service({ brokers: brokers([record]), companies: null }).sync();
    expect(result).toMatchObject({ added: 0, updated: 1, retired: 0 });
    expect(rows()[0]?.retired).toBe(false);
  });

  it("keeps existing targets of a kind whose dataset is unavailable", () => {
    service({
      brokers: brokers([makeBroker({ id: "b1" })]),
      companies: companies([makeCompany({ id: "c1" })]),
    }).sync();
    const result = service({
      brokers: null,
      companies: companies([makeCompany({ id: "c1" })]),
    }).sync();
    expect(result.retired).toBe(0);
    expect(rows().every((r) => !r.retired)).toBe(true);
  });

  it("keeps every company when the company file is missing from a build", () => {
    service({
      brokers: brokers([makeBroker({ id: "b1" })]),
      companies: companies([makeCompany({ id: "c1" })]),
    }).sync();
    const missingFile = datasetSources({
      hasBrokers: () => true,
      loadBrokers: () => ({
        generatedAt: "2026-10-07T00:00:00.000Z",
        license: "CC-BY-NC-SA-4.0",
        attribution: "test",
        brokers: [makeBroker({ id: "b1" })],
      }),
      hasCompanies: () => false,
      loadCompanies: () => {
        throw new Error("The company file does not exist");
      },
    });
    expect(missingFile.companies()).toBeNull();
    const result = createTargetsService({
      db: ctx.services.db,
      clock: ctx.clock,
      logger: ctx.services.logger,
      sources: missingFile,
      extraTargetsPath: null,
    }).sync();
    expect(result.retired).toBe(0);
    expect(rows().find((r) => r.id === "c1")?.retired).toBe(false);
  });

  it("lets a record that changed id take over the old record's domain", () => {
    service({
      brokers: brokers([makeBroker({ id: "old-id", domain: "same.test" })]),
      companies: null,
    }).sync();
    const result = service({
      brokers: brokers([makeBroker({ id: "new-id", domain: "same.test" })]),
      companies: null,
    }).sync();
    expect(result).toMatchObject({ added: 1, retired: 1 });
    const byId = new Map(rows().map((r) => [r.id, r]));
    expect(byId.get("old-id")?.retired).toBe(true);
    expect(byId.get("new-id")?.retired).toBe(false);
  });

  it("refuses an id shared by a broker and a company", () => {
    expect(() =>
      service({
        brokers: brokers([makeBroker({ id: "experian", domain: "experian.test" })]),
        companies: companies([makeCompany({ id: "experian", domain: "experian-co.test" })]),
      }).sync(),
    ).toThrow(/Target id "experian" is used by/);
    expect(rows()).toEqual([]);
  });

  it("collapses two records with one domain, keeping the later", () => {
    const result = service({
      brokers: brokers([
        makeBroker({ id: "a", domain: "dup.test", name: "First" }),
        makeBroker({ id: "b", domain: "dup.test", name: "Second" }),
      ]),
      companies: null,
    }).sync();
    expect(result.total).toBe(1);
    expect(rows()[0]).toMatchObject({ id: "b", name: "Second" });
  });

  it("loads the real broker dataset", () => {
    const real = createTargetsService({
      db: ctx.services.db,
      clock: ctx.clock,
      logger: ctx.services.logger,
      sources: datasetSources(),
      extraTargetsPath: null,
    });
    const first = real.sync();
    expect(first.added).toBeGreaterThan(500);
    expect(first.retired).toBe(0);
    expect(real.sync()).toMatchObject({ added: 0, updated: 0, retired: 0 });
  });
});

describe("replyDomainsOfRow", () => {
  it("covers the vendor behind a company's privacy email and its explicit list", () => {
    const company = makeCompany({
      id: "shop",
      domain: "shop.test",
      privacyEmail: "privacy@vendor.test",
      replyDomains: ["mail.sister.test"],
    });
    service({ brokers: null, companies: companies([company]) }).sync();
    expect(replyDomainsOfRow(rows()[0] as never)).toEqual([
      "shop.test",
      "vendor.test",
      "mail.sister.test",
    ]);
  });
});

describe("extra targets", () => {
  it("adds fixtures from the extra file", () => {
    const path = writeExtra({
      brokers: [
        makeBroker({ id: "fixture", category: "people-search", requirements: ["record_url"] }),
      ],
      companies: [makeCompany({ id: "fixture-co" })],
    });
    const result = service({ brokers: brokers([]), companies: companies([]) }, path).sync();
    expect(result).toMatchObject({ added: 2 });
    expect(rows().map((r) => [r.id, r.datasetVersion])).toEqual([
      ["fixture", "extra"],
      ["fixture-co", "extra"],
    ]);
  });

  it("lets an extra record replace a dataset record with the same domain", () => {
    const path = writeExtra({
      brokers: [makeBroker({ id: "local", domain: "shared.test", name: "Local override" })],
    });
    service(
      {
        brokers: brokers([makeBroker({ id: "upstream", domain: "shared.test" })]),
        companies: null,
      },
      path,
    ).sync();
    const live = rows().filter((r) => !r.retired);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: "local", name: "Local override" });
  });

  it("works when the datasets are unavailable", () => {
    const path = writeExtra({ brokers: [makeBroker({ id: "fixture" })] });
    expect(service({ brokers: null, companies: null }, path).sync().added).toBe(1);
  });

  it("accepts a file with only one list", () => {
    const path = writeExtra({ companies: [makeCompany({ id: "only-company" })] });
    expect(service({ brokers: null, companies: null }, path).sync().added).toBe(1);
  });

  it("fails loudly on a missing, malformed, or invalid file", () => {
    expect(() =>
      service({ brokers: null, companies: null }, join(dir, "missing.json")).sync(),
    ).toThrow(/Cannot read KICKROCKS_EXTRA_TARGETS/);
    expect(() => service({ brokers: null, companies: null }, writeExtra("{ nope")).sync()).toThrow(
      /Cannot read KICKROCKS_EXTRA_TARGETS/,
    );
    expect(() =>
      service({ brokers: null, companies: null }, writeExtra({ brokers: [{ id: "x" }] })).sync(),
    ).toThrow(/KICKROCKS_EXTRA_TARGETS at .* is invalid/);
  });

  it("is picked up from the config path at startup", async () => {
    const path = writeExtra({ brokers: [makeBroker({ id: "from-env" })] });
    const withExtra = await createTestContext({
      env: { KICKROCKS_EXTRA_TARGETS: path },
      targetSources: {
        brokers: () => ({ version: "t", records: [] }),
        companies: () => ({ version: "t", records: [] }),
      },
    });
    try {
      expect(withExtra.services.targets.get("from-env")?.datasetVersion).toBe("extra");
    } finally {
      await withExtra.close();
    }
  });
});

describe("lookups", () => {
  it("returns summaries with needsRecord derived from the category", () => {
    const real = service({
      brokers: brokers([
        makeBroker({ id: "ps", category: "people-search", requirements: ["record_url"] }),
        makeBroker({ id: "ps-unflagged", category: "people-search", requirements: [] }),
        makeBroker({ id: "bg", category: "background-check", requirements: [] }),
        makeBroker({ id: "mk", category: "marketing", requirements: ["record_url"] }),
      ]),
      companies: null,
    });
    real.sync();
    expect(real.get("ps")?.name).toBe(real.summary("ps").name);
    expect(real.summary("ps")).toMatchObject({
      id: "ps",
      kind: "broker",
      needsRecord: true,
      requirements: ["record_url"],
    });
    expect(real.summary("ps-unflagged").needsRecord).toBe(true);
    expect(real.summary("bg").needsRecord).toBe(true);
    expect(real.summary("mk").needsRecord).toBe(false);
    expect(real.get("missing")).toBeNull();
    expect(() => real.getOrThrow("missing")).toThrow(/Target missing not found/);
    expect(() => real.summary("missing")).toThrow(/not found/);
  });

  it("marks a broker California registered by its source, whatever its category", () => {
    const real = service({
      brokers: brokers([
        makeBroker({
          id: "ca-listed",
          category: "people-search",
          sources: [{ source: "ca-registry-2026", license: "public-record" }],
        }),
        makeBroker({ id: "unlisted", category: "registered-broker" }),
      ]),
      companies: null,
    });
    real.sync();
    expect(real.summary("ca-listed").californiaRegistered).toBe(true);
    expect(real.summary("unlisted").californiaRegistered).toBe(false);
  });
});
