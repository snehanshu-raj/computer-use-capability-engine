import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Page } from "playwright";
import type { JsonlRunLogger } from "../core/logger.js";

export interface InterventionRequest {
  id: string;
  runId: string;
  capabilityId: string;
  goal: string;
  stepId: string | null;
  reason: string;
  currentUrl: string;
  createdAt: string;
}

export interface HumanAction {
  timestamp: string;
  type: "click" | "type" | "key";
  detail: Record<string, unknown>;
}

export type ControlOwner = "automation" | "available" | "human";

interface BridgeState {
  owner: ControlOwner;
  request: InterventionRequest | null;
  actions: HumanAction[];
}

const operatorHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Operator Handoff Console</title>
  <style>
    body { margin: 0; font: 14px Arial, sans-serif; background: #101827; color: #e7eef9; }
    header { padding: 14px 18px; background: #1c2b43; display: flex; gap: 16px; align-items: center; }
    main { display: grid; grid-template-columns: 320px 1fr; gap: 18px; padding: 18px; }
    .panel { background: #1c2b43; border: 1px solid #42536d; border-radius: 6px; padding: 14px; }
    button { padding: 9px 12px; margin: 4px; cursor: pointer; }
    textarea { width: 100%; min-height: 70px; box-sizing: border-box; }
    img { width: 100%; border: 1px solid #71819a; cursor: crosshair; background: white; }
    code { overflow-wrap: anywhere; }
    .owner { font-weight: bold; color: #ffd166; }
  </style>
</head>
<body>
  <header><strong>Operator Handoff Console</strong><span>Control: <span class="owner" id="owner">loading</span></span></header>
  <main>
    <section class="panel">
      <h2>Intervention</h2>
      <div id="context"></div>
      <button id="take">Take control</button>
      <button id="resume">Resume automation</button>
      <h3>Keyboard input</h3>
      <textarea id="text" placeholder="Click a field in the screenshot, then type here"></textarea>
      <button id="type">Type text</button>
      <button id="enter">Press Enter</button>
      <p>The screenshot controls the original browser page. Click coordinates are forwarded to that same live Playwright session.</p>
    </section>
    <section class="panel"><img id="screen" alt="Live target session"></section>
  </main>
  <script>
    let state;
    async function post(path, body = {}) {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) alert(await response.text());
      await refresh();
    }
    async function refresh() {
      const response = await fetch("/api/state", { cache: "no-store" });
      state = await response.json();
      document.querySelector("#owner").textContent = state.owner;
      const request = state.request;
      document.querySelector("#context").innerHTML = request
        ? "<p><b>Reason:</b> " + request.reason + "</p><p><b>Goal:</b> " + request.goal + "</p><p><code>" + request.currentUrl + "</code></p>"
        : "<p>No active request.</p>";
      if (state.screenshot) document.querySelector("#screen").src = state.screenshot;
    }
    document.querySelector("#take").onclick = () => post("/api/take-control");
    document.querySelector("#resume").onclick = () => post("/api/resume");
    document.querySelector("#type").onclick = () => post("/api/action", { type: "type", text: document.querySelector("#text").value });
    document.querySelector("#enter").onclick = () => post("/api/action", { type: "key", key: "Enter" });
    document.querySelector("#screen").onclick = event => {
      const image = event.currentTarget;
      const x = event.offsetX * image.naturalWidth / image.clientWidth;
      const y = event.offsetY * image.naturalHeight / image.clientHeight;
      post("/api/action", { type: "click", x, y });
    };
    setInterval(refresh, 1000);
    refresh();
  </script>
</body>
</html>`;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export class OperatorBridge {
  private server: Server | null = null;
  private resume: (() => void) | null = null;
  private state: BridgeState = { owner: "automation", request: null, actions: [] };

  constructor(
    private readonly page: Page,
    private readonly logger: JsonlRunLogger,
    private readonly port = Number(process.env.OPERATOR_PORT ?? 4310),
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => {
      void this.route(request, response).catch(error => {
        json(response, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, "127.0.0.1", resolve);
    });
  }

  async requestIntervention(request: InterventionRequest): Promise<HumanAction[]> {
    await this.start();
    if (this.state.request) throw new Error("An intervention is already active");
    this.state = { owner: "available", request, actions: [] };
    await this.logger.log({
      runId: request.runId,
      type: "intervention_requested",
      data: { ...request, operatorUrl: this.url },
    });
    console.log(`Human intervention required: ${this.url}`);

    await new Promise<void>(resolve => {
      this.resume = resolve;
    });
    const actions = [...this.state.actions];
    this.state = { owner: "automation", request: null, actions: [] };
    this.resume = null;
    await this.logger.log({
      runId: request.runId,
      type: "intervention_resumed",
      data: { actionCount: actions.length, actions },
    });
    return actions;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>(resolve => this.server?.close(() => resolve()));
    this.server = null;
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(operatorHtml);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      const screenshot = await this.page.screenshot({ type: "png" });
      json(response, 200, {
        ...this.state,
        screenshot: `data:image/png;base64,${screenshot.toString("base64")}`,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/take-control") {
      if (this.state.owner !== "available") {
        json(response, 409, { error: "Control is not available" });
        return;
      }
      this.state.owner = "human";
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/action") {
      if (this.state.owner !== "human") {
        json(response, 409, { error: "Take control before sending actions" });
        return;
      }
      const body = await readJson(request);
      const type = body.type;
      if (type === "click") {
        const x = Number(body.x);
        const y = Number(body.y);
        await this.page.mouse.click(x, y);
        this.record("click", { x: Math.round(x), y: Math.round(y) });
      } else if (type === "type") {
        const text = String(body.text ?? "");
        await this.page.keyboard.type(text);
        this.record("type", { characterCount: text.length, content: "[REDACTED]" });
      } else if (type === "key") {
        const key = String(body.key ?? "");
        if (!/^(Enter|Tab|Escape|ArrowUp|ArrowDown)$/.test(key)) {
          json(response, 400, { error: "Key is not allowed" });
          return;
        }
        await this.page.keyboard.press(key);
        this.record("key", { key });
      } else {
        json(response, 400, { error: "Unsupported human action" });
        return;
      }
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/resume") {
      if (this.state.owner !== "human") {
        json(response, 409, { error: "Only the controlling human can resume automation" });
        return;
      }
      this.state.owner = "automation";
      this.resume?.();
      json(response, 200, { ok: true });
      return;
    }
    json(response, 404, { error: "Not found" });
  }

  private record(type: HumanAction["type"], detail: Record<string, unknown>): void {
    this.state.actions.push({ timestamp: new Date().toISOString(), type, detail });
  }
}
