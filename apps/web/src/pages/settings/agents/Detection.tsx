import type { AgentSetupView } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { RelativeTime, Row, RowGroup, StatusShapeGlyph } from "../../../components/ui/index.js";
import type { StatusShape } from "../../../lib/status.js";
import { useNow } from "../../../lib/use-now.js";
import { workerState } from "../model.js";
import { addressOf, gigabytes, PROBE_ERROR_WORDS, workerGpuWords } from "./setup-model.js";

interface Found {
  shape: StatusShape;
  text: ReactNode;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function serverFound(view: AgentSetupView): Found {
  const { endpoints } = view.components.server;
  const reply = endpoints.find((endpoint) => endpoint.reachable);
  if (reply) {
    const version = reply.version ? `, v${reply.version}` : "";
    return {
      shape: "disc",
      text: `${addressOf(reply.baseUrl)}${version}, ${plural(reply.models.length, "model")}`,
    };
  }
  const only = endpoints.length === 1 ? endpoints[0] : undefined;
  if (only?.error) {
    return {
      shape: "triangle",
      text: `${addressOf(only.baseUrl)}: ${PROBE_ERROR_WORDS[only.error]}`,
    };
  }
  return { shape: "ring", text: "Not found at the usual addresses" };
}

function workerOllamaFound(view: AgentSetupView): Found {
  const worker = view.components.worker;
  if (!worker) return { shape: "ring", text: "Waiting for the agent worker" };
  const model = worker.status.model;
  if (model && model.provider !== "ollama") {
    return {
      shape: "ring",
      text: `The agent worker uses ${model.provider}, ${model.name}; no local recommendation`,
    };
  }
  const ollama = worker.ollama;
  if (!ollama) return { shape: "ring", text: "The agent worker has not reported its Ollama" };
  if (!ollama.reachable) {
    const why = ollama.error ? PROBE_ERROR_WORDS[ollama.error] : "nothing answered";
    return { shape: "triangle", text: `${addressOf(ollama.baseUrl)}: ${why}` };
  }
  const loaded = ollama.loaded[0];
  const detail = loaded
    ? `${loaded.name} loaded, ${gigabytes(loaded.sizeVramBytes)} on GPU`
    : plural(ollama.models.length, "model");
  return { shape: "disc", text: `${addressOf(ollama.baseUrl)}, ${detail}` };
}

function Mark({ shape }: { shape: StatusShape }) {
  return <StatusShapeGlyph shape={shape} className="ml-1" />;
}

/** What was found, one row per piece: the server's Ollama, the agent worker, and the worker's Ollama. */
export function Detection({ view }: { view: AgentSetupView }) {
  const now = useNow();
  const worker = view.components.worker;
  const merged =
    (view.sameOllama === "yes" || view.sameOllama === "probably") &&
    worker?.ollama?.reachable === true;
  const server = serverFound(view);
  const workerOllama = workerOllamaFound(view);
  const loaded = worker?.ollama?.loaded[0];
  const loadedWords = loaded
    ? `, ${loaded.name} loaded, ${gigabytes(loaded.sizeVramBytes)} on GPU`
    : "";

  return (
    <RowGroup>
      {merged ? (
        <Row
          leading={<Mark shape={server.shape} />}
          title="Ollama for replies and the agent"
          description={`${server.text}${loadedWords}${
            view.sameOllama === "probably" ? ". Probably the same server for both." : ""
          }`}
          wrapDescription
        />
      ) : (
        <Row
          leading={<Mark shape={server.shape} />}
          title="Ollama for replies (server)"
          description={server.text}
          wrapDescription
        />
      )}
      <Row
        leading={
          <Mark
            shape={
              worker
                ? workerState(worker.status.lastSeenAt, now) === "online"
                  ? "disc"
                  : "triangle"
                : "ring"
            }
          />
        }
        title="Agent worker"
        description={
          worker ? (
            <>
              {worker.status.workerId}, seen <RelativeTime iso={worker.status.lastSeenAt} />,{" "}
              {workerGpuWords(worker)}
            </>
          ) : (
            "No agent worker has reported"
          )
        }
        wrapDescription
      />
      {merged ? null : (
        <Row
          leading={<Mark shape={workerOllama.shape} />}
          title="Ollama for the agent (from the worker)"
          description={workerOllama.text}
          wrapDescription
        />
      )}
    </RowGroup>
  );
}
