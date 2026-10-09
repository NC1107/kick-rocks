import { loadBrokers } from "@kickrocks/brokers";
import { describe, expect, it } from "vitest";
import { measureCoverage } from "./coverage-measure.js";

describe("dataset coverage", () => {
  const result = measureCoverage();

  it("has no contradiction between the dataset, the recipes and the planner that is not a judgment call", () => {
    expect(result.contradictions).toEqual([]);
  });

  it("keeps a judgment call only while the contradiction it excuses still exists", () => {
    expect(result.judgmentCalls.filter((call) => !call.matched)).toEqual([]);
  });

  it("plans brokers whose Eraser record refuses email to their forms, not to a registry address", () => {
    const refusing = [
      "the-data-group",
      "videoamp",
      "steppingblocks",
      "semasio",
      "spy-dialer",
      "datonics",
      "nextroll",
    ];
    const byId = new Map(loadBrokers().map((broker) => [broker.id, broker] as const));
    for (const id of refusing) {
      expect(byId.get(id)?.privacyEmail, id).toBeNull();
      expect(byId.get(id)?.contactMethod, id).toBe("form");
    }
  });

  it("keeps the registry address when the note records a bounce of a different address", () => {
    const byDomain = new Map(loadBrokers().map((broker) => [broker.domain, broker] as const));
    const untried = {
      "fourleafdata.com": "privacy@fourleafdata.com",
      "thomsonreuters.com": "privacy.enquiries@thomsonreuters.com",
      "fusable.com": "privacy@fusable.com",
      "modigie.com": "dpauli@modigie.com",
      "date-detective.app": "info@date-detective.app",
    };
    for (const [domain, address] of Object.entries(untried)) {
      expect(byDomain.get(domain)?.privacyEmail, domain).toBe(address);
    }
    expect(byDomain.get("precisely.com")?.privacyEmail).toMatch(/@precisely\.com$/);
  });

  it("keeps email for brokers whose note says email still works", () => {
    const byDomain = new Map(loadBrokers().map((broker) => [broker.domain, broker] as const));
    for (const domain of ["placeexchange.com", "apollointeractive.com", "seamless.ai"]) {
      expect(byDomain.get(domain)?.privacyEmail, domain).not.toBeNull();
    }
  });

  it("plans brokers whose form takes only a device identifier as unsupported, not as a form", () => {
    const byDomain = new Map(loadBrokers().map((broker) => [broker.domain, broker] as const));
    for (const domain of [
      "mobilewalla.com",
      "outlogic.io",
      "collectivedata.io",
      "groundtruth.com",
      "irys.us",
    ]) {
      const broker = byDomain.get(domain);
      expect(broker?.privacyEmail, domain).toBeNull();
      expect(broker?.optOutUrl, domain).toBeNull();
    }
  });

  it("plans every target of each fixed profile exactly once", () => {
    for (const share of Object.values(result.planner)) {
      const planned = Object.values(share.counts).reduce((sum, count) => sum + count, 0);
      expect(planned).toBe(share.total);
    }
  });
});
