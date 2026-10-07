import { NotImplementedError } from "@kickrocks/shared";
import type { LegalApi } from "./types.js";

export type { EmailKind, LegalApi, RenderRequestEmailInput } from "./types.js";

export const resolveLegalBasis: LegalApi["resolveLegalBasis"] = () => {
  throw new NotImplementedError("resolveLegalBasis");
};

export const listJurisdictions: LegalApi["listJurisdictions"] = () => {
  throw new NotImplementedError("listJurisdictions");
};

export const identifiersFor: LegalApi["identifiersFor"] = () => {
  throw new NotImplementedError("identifiersFor");
};

export const renderRequestEmail: LegalApi["renderRequestEmail"] = () => {
  throw new NotImplementedError("renderRequestEmail");
};
