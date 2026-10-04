import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Redactor } from "./redaction.js";

export interface RunEvent {
  timestamp: string;
  runId: string;
  type: string;
  stepId?: string;
  data?: unknown;
}

export class JsonlRunLogger {
  constructor(
    readonly path: string,
    private readonly redactor = new Redactor(),
  ) {}

  async log(event: Omit<RunEvent, "timestamp">): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const safe = this.redactor.redact({
      timestamp: new Date().toISOString(),
      ...event,
    });
    await appendFile(this.path, `${JSON.stringify(safe)}\n`, "utf8");
  }
}
