import type { ReplyModelManifest } from "./manifest.js";

/** What the server sends to the child that holds the model. */
export type ToWorker =
  | { type: "load"; dir: string; threads: number; manifest: ReplyModelManifest }
  | { type: "predict"; id: number; text: string };

/** What the child answers. Probabilities follow the manifest's label order. */
export type FromWorker =
  | { type: "ready"; loadMs: number; rssBytes: number }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; probabilities: number[]; ms: number }
  | { type: "error"; id: number; message: string };
