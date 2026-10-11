/**
 * The child process that holds the model. Loading and running both block the thread that does
 * them, so they live here and not in the server, and the memory goes back to the system when the
 * child exits.
 */
import type { FromWorker, ToWorker } from "./protocol.js";
import type { LoadedModel } from "./runtime.js";

function send(message: FromWorker): void {
  process.send?.(message);
}

let model: LoadedModel | null = null;

async function load(message: Extract<ToWorker, { type: "load" }>): Promise<void> {
  const started = performance.now();
  try {
    const { loadModel } = await import("./runtime.js");
    model = await loadModel(message.dir, message.manifest, message.threads, {
      verified: message.verified,
    });
    send({ type: "ready", loadMs: performance.now() - started, rssBytes: model.rssBytes() });
  } catch (error) {
    send({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
}

async function predict(message: Extract<ToWorker, { type: "predict" }>): Promise<void> {
  if (!model) {
    send({ type: "error", id: message.id, message: "The model is not loaded" });
    return;
  }
  const started = performance.now();
  try {
    const probabilities = await model.probabilities(message.text);
    send({ type: "result", id: message.id, probabilities, ms: performance.now() - started });
  } catch (error) {
    send({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

process.on("message", (message: ToWorker) => {
  if (message.type === "load") void load(message);
  else void predict(message);
});

process.on("disconnect", () => process.exit(0));
