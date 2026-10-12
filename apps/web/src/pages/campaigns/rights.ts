import type { RequestRight } from "@kickrocks/shared";

export const RIGHT_HELP: Record<RequestRight, string> = {
  opt_out: "Stop selling or sharing my data.",
  delete: "Erase data; may close accounts",
};

export const RIGHT_TOKENS: Record<RequestRight, string> = {
  opt_out: "opt-out",
  delete: "delete",
};

export const RIGHT_ORDER: readonly RequestRight[] = ["opt_out", "delete"];
