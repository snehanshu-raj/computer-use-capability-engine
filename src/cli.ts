import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenAIPlanner } from "./agent/openai-planner.js";
import { discoverCapability } from "./agent/discovery.js";
import { defaultGoal, inputSpecs, outputSpecs, targetUrl } from "./config.js";
import { JsonlRunLogger } from "./core/logger.js";
import { Redactor } from "./core/redaction.js";
import { CapabilityArtifactSchema } from "./core/schema.js";
import { OperatorBridge } from "./handoff/operator-bridge.js";
import { replayCapability } from "./replay/replay.js";
import { PlaywrightSurface } from "./surface/playwright.js";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  return value?.replace(/\^(?=\s)/g, "");
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "discover") await discover();
  else if (command === "replay") await replay();
  else {
    console.error("Usage: npm run discover -- [options] | npm run replay -- [options]");
    process.exitCode = 2;
  }
}

async function discover(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for a genuine discovery run");
  }
  const memberId = arg("--member-id", "10001") as string;
  const entryUrl = arg("--url", targetUrl()) as string;
  const goal = arg(
    "--goal",
    `Look up member ${memberId} and return their current savings balance.`,
  ) as string;
  const artifactPath = resolve(arg("--artifact", "artifacts/lookup-savings.generated.json") as string);
  const runRoot = resolve(arg("--run-dir", "runs/discovery") as string);
  const logger = new JsonlRunLogger(
    resolve(runRoot, "events.jsonl"),
    new Redactor(new Set(["memberId", "savingsBalance"]), new Set([memberId])),
  );
  const surface = new PlaywrightSurface({ headless: !has("--headed"), slowMo: has("--headed") ? 120 : 0 });
  await surface.start(entryUrl);
  const operator = has("--operator")
    ? new OperatorBridge(surface.activePage, logger)
    : undefined;
  try {
    const result = await discoverCapability({
      goal,
      entryUrl,
      inputs: { memberId },
      inputSpecs,
      outputSpecs,
      planner: new OpenAIPlanner(),
      surface,
      logger,
      evidenceDir: resolve(runRoot, "screenshots"),
      artifactPath,
      ...(operator ? { operator } : {}),
    });
    console.log(JSON.stringify({ runId: result.runId, artifactPath, outputs: result.outputs }, null, 2));
  } finally {
    await operator?.close();
    await surface.close();
  }
}

async function replay(): Promise<void> {
  const artifactPath = resolve(arg("--artifact", "artifacts/lookup-savings.generated.json") as string);
  const artifact = CapabilityArtifactSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")));
  const memberId = arg("--member-id", "10001") as string;
  const entryUrl = arg("--url", `${artifact.target.baseUrl}/app`) as string;
  const runRoot = resolve(arg("--run-dir", "runs/replay") as string);
  const logger = new JsonlRunLogger(
    resolve(runRoot, "events.jsonl"),
    new Redactor(
      new Set([...artifact.policy.sensitiveInputNames, "savingsBalance"]),
      new Set([memberId]),
    ),
  );
  const surface = new PlaywrightSurface({ headless: !has("--headed"), slowMo: has("--headed") ? 120 : 0 });
  await surface.start(entryUrl);
  const operator = has("--operator")
    ? new OperatorBridge(surface.activePage, logger)
    : undefined;
  try {
    const result = await replayCapability({
      artifact,
      inputs: { memberId },
      surface,
      logger,
      evidenceDir: resolve(runRoot, "evidence"),
      entryUrl,
      ...(operator ? { operator } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failure") process.exitCode = 1;
  } finally {
    await operator?.close();
    await surface.close();
  }
}

await main();
