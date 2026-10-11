// Stands in for the child that holds the model, so the host's process handling can be tested
// without 571 MB of weights. The text it is asked about steers what it does.
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let labels = 0;
let dir = "";

process.on("message", (message) => {
  if (message.type === "load") {
    dir = message.dir;
    labels = message.manifest.labels.length;
    appendFileSync(join(dir, "starts.log"), `${process.pid}\n`);
    appendFileSync(join(dir, "verified.log"), `${message.verified}\n`);
    appendFileSync(join(dir, "env.log"), `${process.env.ORT_DISABLE_TELEMETRY}\n`);
    if (existsSync(join(dir, "FAIL_LOAD"))) {
      process.send({
        type: "failed",
        message: "model.onnx does not match its digest in the manifest",
      });
    } else {
      process.send({ type: "ready", loadMs: 1, rssBytes: 1 });
    }
    return;
  }
  if (message.text.includes("HANG")) return;
  if (message.text.includes("CRASH")) process.exit(1);
  const probabilities = Array(labels).fill(0.01);
  const hot = message.text.includes("SECOND") ? 1 : 0;
  probabilities[hot] = 1 - 0.01 * (labels - 1);
  process.send({ type: "result", id: message.id, probabilities, ms: 1 });
});

process.on("disconnect", () => process.exit(0));
