import { once } from "node:events";
import { resolve } from "node:path";
import { OpenAIPlanner } from "./agent/openai-planner.js";
import { discoverCapability } from "./agent/discovery.js";
import { defaultGoal, inputSpecs, outputSpecs, targetUrl } from "./config.js";
import { JsonlRunLogger } from "./core/logger.js";
import { Redactor } from "./core/redaction.js";
import { replayCapability } from "./replay/replay.js";
import { PlaywrightSurface } from "./surface/playwright.js";
import { startTargetServer } from "./target/server.js";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for npm run demo");

const server = await startTargetServer();
const discoverySurface = new PlaywrightSurface({ headless: true });
try {
  const discovery = await discoverCapability({
    goal: defaultGoal,
    entryUrl: targetUrl(),
    inputs: { memberId: "10001" },
    inputSpecs,
    outputSpecs,
    planner: new OpenAIPlanner(),
    surface: discoverySurface,
    logger: new JsonlRunLogger(
      resolve("runs/demo/discovery.jsonl"),
      new Redactor(new Set(["memberId", "savingsBalance"]), new Set(["10001"])),
    ),
    evidenceDir: resolve("runs/demo/discovery"),
    artifactPath: resolve("artifacts/lookup-savings.generated.json"),
  });
  await discoverySurface.close();

  const replaySurface = new PlaywrightSurface({ headless: true });
  const replay = await replayCapability({
    artifact: discovery.artifact,
    inputs: { memberId: "10002" },
    surface: replaySurface,
    logger: new JsonlRunLogger(
      resolve("runs/demo/replay.jsonl"),
      new Redactor(new Set(["memberId", "savingsBalance"]), new Set(["10002"])),
    ),
    evidenceDir: resolve("runs/demo/replay"),
    entryUrl: targetUrl(),
  });
  await replaySurface.close();
  console.log(JSON.stringify({ discovery: discovery.outputs, replay }, null, 2));
} finally {
  await discoverySurface.close();
  server.close();
  await once(server, "close");
}
