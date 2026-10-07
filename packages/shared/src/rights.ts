import { z } from "zod";

/** What a request asks for: to stop selling or sharing the person's data, or to delete it. */
export const RequestRight = z.enum(["opt_out", "delete"]);
export type RequestRight = z.infer<typeof RequestRight>;
