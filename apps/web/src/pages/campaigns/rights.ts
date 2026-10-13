import type { RequestRight } from "@kickrocks/shared";

export const RIGHT_HELP: Record<RequestRight, string> = {
  opt_out: "Stop selling or sharing my data.",
  delete: "Erase data; may close accounts.",
};

export const RIGHT_TOKENS: Record<RequestRight, string> = {
  opt_out: "opt-out",
  delete: "delete",
};

/** What the builder calls each right on its checkbox and in the confirm dialog. */
export const RIGHT_CHOICES: Record<RequestRight, string> = {
  opt_out: "Stop selling my data",
  delete: "Delete my data",
};

export const RIGHT_ORDER: readonly RequestRight[] = ["opt_out", "delete"];
