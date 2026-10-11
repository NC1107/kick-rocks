import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * A child process that answers one JSON line per JSON line. A model stays loaded in it between
 * replies, so a reply's time is the model's time and not the time to start Python.
 */
export class JsonlProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting: ((line: string) => void)[] = [];
  private readonly buffered: string[] = [];
  private closed = false;
  private stderr = "";

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
    this.child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const next = this.waiting.shift();
      if (next) next(line);
      else this.buffered.push(line);
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
    });
    this.child.on("close", () => {
      this.closed = true;
      for (const next of this.waiting.splice(0)) next("");
    });
  }

  private nextLine(): Promise<string> {
    const line = this.buffered.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.resolve("");
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async read<T>(): Promise<T> {
    const line = await this.nextLine();
    if (line === "") throw new Error(`The process ended: ${this.stderr.trim().split("\n").pop()}`);
    return JSON.parse(line) as T;
  }

  async request<T>(payload: unknown): Promise<T> {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return this.read<T>();
  }

  stop(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}
