import { NotImplementedError } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  getLegalBasis,
  identifiersFor,
  listJurisdictions,
  renderRequestEmail,
  resolveLegalBasis,
} from "./index.js";

describe("legal skeleton", () => {
  it("fails loudly until the module is filled in", () => {
    expect(() => resolveLegalBasis({} as never)).toThrow(NotImplementedError);
    expect(() => getLegalBasis("policy", "TX")).toThrow(NotImplementedError);
    expect(() => listJurisdictions()).toThrow(NotImplementedError);
    expect(() => identifiersFor({} as never, [], "email")).toThrow(NotImplementedError);
    expect(() => renderRequestEmail({} as never)).toThrow(NotImplementedError);
  });
});
