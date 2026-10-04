import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverCapability } from "../src/agent/discovery.js";
import { ScriptedPlanner } from "../src/agent/scripted-planner.js";
import { inputSpecs, outputSpecs, targetUrl } from "../src/config.js";
import { JsonlRunLogger } from "../src/core/logger.js";
import { Redactor } from "../src/core/redaction.js";
import { OperatorBridge } from "../src/handoff/operator-bridge.js";
import { replayCapability } from "../src/replay/replay.js";
import { PlaywrightSurface } from "../src/surface/playwright.js";
import { startTargetServer } from "../src/target/server.js";

const evidenceDir = "evidence";
const artifactPath = join(evidenceDir, "example-capability.json");
const redactorFor = (value: string) =>
  new Redactor(new Set(["memberId", "savingsBalance"]), new Set([value]));

for (const path of [
  "offline-discovery.jsonl",
  "offline-replay-success.jsonl",
  "offline-replay-business-outcome.jsonl",
  "offline-handoff.jsonl",
  "offline-handoff-console.png",
]) {
  await rm(join(evidenceDir, path), { force: true });
}
await rm(join(evidenceDir, "offline-discovery"), { recursive: true, force: true });
await rm(join(evidenceDir, "offline-replay"), { recursive: true, force: true });

const server = await startTargetServer();
try {
  const discoverySurface = new PlaywrightSurface({ headless: true });
  const discovery = await discoverCapability({
    goal: "Look up member 10001 and return their current savings balance.",
    entryUrl: targetUrl(),
    inputs: { memberId: "10001" },
    inputSpecs,
    outputSpecs,
    planner: new ScriptedPlanner("10001"),
    surface: discoverySurface,
    logger: new JsonlRunLogger(join(evidenceDir, "offline-discovery.jsonl"), redactorFor("10001")),
    evidenceDir: join(evidenceDir, "offline-discovery"),
    artifactPath,
  });
  await discoverySurface.close();

  const successSurface = new PlaywrightSurface({ headless: true });
  const success = await replayCapability({
    artifact: discovery.artifact,
    inputs: { memberId: "10002" },
    surface: successSurface,
    logger: new JsonlRunLogger(
      join(evidenceDir, "offline-replay-success.jsonl"),
      redactorFor("10002"),
    ),
    evidenceDir: join(evidenceDir, "offline-replay"),
    entryUrl: targetUrl(),
  });
  await successSurface.close();

  const outcomeSurface = new PlaywrightSurface({ headless: true });
  const businessOutcome = await replayCapability({
    artifact: discovery.artifact,
    inputs: { memberId: "40404" },
    surface: outcomeSurface,
    logger: new JsonlRunLogger(
      join(evidenceDir, "offline-replay-business-outcome.jsonl"),
      redactorFor("40404"),
    ),
    evidenceDir: join(evidenceDir, "offline-replay"),
    entryUrl: targetUrl(),
  });
  await outcomeSurface.close();

  const handoffSurface = new PlaywrightSurface({ headless: true });
  const handoffLogger = new JsonlRunLogger(
    join(evidenceDir, "offline-handoff.jsonl"),
    redactorFor("10001"),
  );
  await handoffSurface.start(`${targetUrl()}?scenario=session-timeout-once`);
  const operator = new OperatorBridge(handoffSurface.activePage, handoffLogger, 4393);
  await operator.start();
  const handoffPromise = replayCapability({
    artifact: discovery.artifact,
    inputs: { memberId: "10001" },
    surface: handoffSurface,
    logger: handoffLogger,
    evidenceDir: join(evidenceDir, "offline-replay"),
    entryUrl: `${targetUrl()}?scenario=session-timeout-once`,
    operator,
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = (await (await fetch(`${operator.url}/api/state`)).json()) as { owner: string };
    if (state.owner === "available") break;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  const consolePage = await handoffSurface.activePage.context().newPage();
  await consolePage.goto(operator.url);
  await consolePage.waitForSelector("#screen[src^='data:image/png']");
  await consolePage.screenshot({
    path: join(evidenceDir, "offline-handoff-console.png"),
    fullPage: true,
  });
  await consolePage.close();
  await fetch(`${operator.url}/api/take-control`, { method: "POST", body: "{}" });
  const box = await handoffSurface.activePage
    .getByRole("button", { name: "Return to sign in" })
    .boundingBox();
  if (!box) throw new Error("Handoff control was not visible");
  await fetch(`${operator.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "click",
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }),
  });
  await fetch(`${operator.url}/api/resume`, { method: "POST", body: "{}" });
  const handoff = await handoffPromise;
  await operator.close();
  await handoffSurface.close();

  await writeFile(
    join(evidenceDir, "offline-results.json"),
    `${JSON.stringify({
      provenance: "scripted planner for repeatable CI evidence, not the required live LLM run",
      discoveryRunId: discovery.runId,
      success: summarize(success),
      businessOutcome: summarize(businessOutcome),
      handoff: summarize(handoff),
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        artifactPath,
        success: success.status,
        businessOutcome: businessOutcome.status,
        handoff: handoff.status,
      },
      null,
      2,
    ),
  );
} finally {
  server.close();
  await once(server, "close");
}

function summarize(result: {
  runId: string;
  status: string;
  code: string;
  outputs: Record<string, unknown>;
  evidence: string[];
}): Record<string, unknown> {
  return {
    runId: result.runId,
    status: result.status,
    code: result.code,
    outputNames: Object.keys(result.outputs),
    evidence: result.evidence,
  };
}
