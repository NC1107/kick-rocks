import { describe, expect, it } from "vitest";
import { describeFailure, plainError } from "./failures.js";

describe("plainError", () => {
  it("replaces internal field names with the words the profile page uses", () => {
    expect(plainError("A reply cannot answer for fields with no value: date_of_birth, zip")).toBe(
      "A reply cannot answer for fields with no value: date of birth, zip code",
    );
  });

  it("leaves other text alone", () => {
    expect(plainError("535 bad credentials")).toBe("535 bad credentials");
  });
});

describe("describeFailure", () => {
  it("calls a missing profile detail by that name and says where to fix it", () => {
    expect(
      describeFailure({
        lastError:
          "This site needs an address on the profile. Add it on the profile page, then retry.",
        failureKind: "internal",
      }),
    ).toMatchObject({
      group: "profile",
      label: "Profile is missing a detail",
      detail: "This site needs an address on the profile.",
      needsProfile: true,
    });
  });

  it("names the site a browser could not reach", () => {
    const view = describeFailure({
      lastError: "page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.whitepages.com/",
      failureKind: "network",
    });
    expect(view.group).toBe("network");
    expect(view.detail).toContain("Could not reach whitepages.com");
    expect(view.detail).not.toContain("net::");
  });

  it("falls back to the failure kind and the error", () => {
    expect(describeFailure({ lastError: "selector missing", failureKind: "recipe" })).toMatchObject(
      {
        group: "recipe",
        detail: "selector missing",
        needsProfile: false,
      },
    );
    expect(describeFailure({ lastError: null, failureKind: null }).group).toBe("internal");
  });
});
