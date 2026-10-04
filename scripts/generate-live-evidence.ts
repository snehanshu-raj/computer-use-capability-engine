import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverCapability } from "../src/agent/discovery.js";
import { OpenAIPlanner } from "../src/agent/openai-planner.js";
import { inputSpecs, outputSpecs, targetUrl } from "../src/config.js";
import { JsonlRunLogger } from "../src/core/logger.js";
import { Redactor } from "../src/core/redaction.js";
import { replayCapability } from "../src/replay/replay.js";
import { PlaywrightSurface } from "../src/surface/playwright.js";
import { startTargetServer } from "../src/target/server.js";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
const evidenceDir = "evidence";
const redactorFor = (value: string) =>
  new Redactor(new Set(["memberId", "savingsBalance"]), new Set([value]));
for (const path of [
  "live-capability.json",
  "live-discovery.jsonl",
  "live-replay.jsonl",
  "live-replay-business-outcome.jsonl",
  "live-results.json",
]) {
  await rm(join(evidenceDir, path), { force: true });
}
await rm(join(evidenceDir, "live-discovery"), { recursive: true, force: true });
await rm(join(evidenceDir, "live-replay"), { recursive: true, force: true });
const server = await startTargetServer();
try {
  const discoverySurface = new PlaywrightSurface({ headless: true });
  const discovery = await discoverCapability({
    goal: "Look up member 10001 and return their current savings balance.",
    entryUrl: targetUrl(),
    inputs: { memberId: "10001" },
    inputSpecs,
    outputSpecs,
    planner: new OpenAIPlanner(),
    surface: discoverySurface,
    logger: new JsonlRunLogger(join(evidenceDir, "live-discovery.jsonl"), redactorFor("10001")),
    evidenceDir: join(evidenceDir, "live-discovery"),
    artifactPath: join(evidenceDir, "live-capability.json"),
  });
  await discoverySurface.close();

  const replaySurface = new PlaywrightSurface({ headless: true });
  const replay = await replayCapability({
    artifact: discovery.artifact,
    inputs: { memberId: "10002" },
    surface: replaySurface,
    logger: new JsonlRunLogger(join(evidenceDir, "live-replay.jsonl"), redactorFor("10002")),
    evidenceDir: join(evidenceDir, "live-replay"),
    entryUrl: targetUrl(),
  });
  await replaySurface.close();

  const outcomeSurface = new PlaywrightSurface({ headless: true });
  const businessOutcome = await replayCapability({
    artifact: discovery.artifact,
    inputs: { memberId: "40404" },
    surface: outcomeSurface,
    logger: new JsonlRunLogger(
      join(evidenceDir, "live-replay-business-outcome.jsonl"),
      redactorFor("40404"),
    ),
    evidenceDir: join(evidenceDir, "live-replay"),
    entryUrl: targetUrl(),
  });
  await outcomeSurface.close();
  const summary = {
    discoveryRunId: discovery.runId,
    plannerProvider: discovery.artifact.capability.discoveredBy.provider,
    plannerModel: discovery.artifact.capability.discoveredBy.model,
    replay: { runId: replay.runId, status: replay.status, code: replay.code },
    businessOutcome: {
      runId: businessOutcome.runId,
      status: businessOutcome.status,
      code: businessOutcome.code,
      evidence: businessOutcome.evidence,
    },
  };
  await writeFile(join(evidenceDir, "live-results.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  server.close();
  await once(server, "close");
}
