import { z } from "zod";

/** What a request asks for: to stop selling or sharing the person's data, or to delete it. */
export const RequestRight = z.enum(["opt_out", "delete"]);
export type RequestRight = z.infer<typeof RequestRight>;

/** What a removal asks for when a record is the person's: both rights, since the site holds a page about them. */
export const RECORD_RIGHTS: readonly RequestRight[] = ["opt_out", "delete"];
