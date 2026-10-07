import { NotImplementedError } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  identifiersFor,
  listJurisdictions,
  renderRequestEmail,
  resolveLegalBasis,
} from "./index.js";

describe("legal skeleton", () => {
  it("fails loudly until the module is filled in", () => {
    expect(() => resolveLegalBasis("TX", new Date())).toThrow(NotImplementedError);
    expect(() => listJurisdictions()).toThrow(NotImplementedError);
    expect(() => identifiersFor({} as never, [], "email")).toThrow(NotImplementedError);
    expect(() => renderRequestEmail({} as never)).toThrow(NotImplementedError);
  });
});
