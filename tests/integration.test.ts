import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverCapability } from "../src/agent/discovery.js";
import { ScriptedPlanner } from "../src/agent/scripted-planner.js";
import { inputSpecs, outputSpecs } from "../src/config.js";
import { JsonlRunLogger } from "../src/core/logger.js";
import { Redactor } from "../src/core/redaction.js";
import { CapabilityArtifactSchema, type CapabilityArtifact } from "../src/core/schema.js";
import { OperatorBridge } from "../src/handoff/operator-bridge.js";
import { replayCapability } from "../src/replay/replay.js";
import { PlaywrightSurface } from "../src/surface/playwright.js";
import { startTargetServer } from "../src/target/server.js";

const port = 4183;
const entryUrl = `http://127.0.0.1:${port}/app`;
const redactorFor = (value: string) =>
  new Redactor(new Set(["memberId", "savingsBalance"]), new Set([value]));

test("discovery records a reusable artifact and replay classifies outcomes", async () => {
  const root = await mkdtemp(join(tmpdir(), "computer-use-test-"));
  const server = await startTargetServer(port);
  let artifact: CapabilityArtifact;
  try {
    const discoverySurface = new PlaywrightSurface({ headless: true });
    const discoveryLog = join(root, "discovery.jsonl");
    const scriptedPlanner = new ScriptedPlanner("10001");
    const aliasedPlanner = {
      provider: scriptedPlanner.provider,
      model: scriptedPlanner.model,
      async decide(context: Parameters<ScriptedPlanner["decide"]>[0]) {
        const decision = await scriptedPlanner.decide(context);
        return decision.action === "extract"
          ? {
              ...decision,
              outputName: "currentSavingsBalance",
              reason: "Extract the displayed balance $4,281.17",
            }
          : decision;
      },
    };
    const discovery = await discoverCapability({
      goal: "Look up member 10001 and return their current savings balance.",
      entryUrl,
      inputs: { memberId: "10001" },
      inputSpecs,
      outputSpecs,
      planner: aliasedPlanner,
      surface: discoverySurface,
      logger: new JsonlRunLogger(discoveryLog, redactorFor("10001")),
      evidenceDir: join(root, "discovery"),
      artifactPath: join(root, "artifact.json"),
    });
    artifact = discovery.artifact;
    await discoverySurface.close();
    assert.deepEqual(artifact.steps.map(step => step.action), ["fill", "click", "click", "extract"]);
    assert.equal(artifact.steps[0]?.value, "{{memberId}}");
    assert.equal(artifact.steps[3]?.value, null);
    assert.doesNotMatch(JSON.stringify(artifact), /10001|\$4,281\.17/);
    assert.equal(discovery.outputs.savingsBalance, "$4,281.17");
    const discoveryEvents = await readFile(discoveryLog, "utf8");
    assert.doesNotMatch(discoveryEvents, /10001|\$4,281\.17/);

    const successSurface = new PlaywrightSurface({ headless: true });
    const success = await replayCapability({
      artifact,
      inputs: { memberId: "10002" },
      surface: successSurface,
      logger: new JsonlRunLogger(join(root, "success.jsonl"), redactorFor("10002")),
      evidenceDir: join(root, "replay"),
      entryUrl,
    });
    await successSurface.close();
    assert.equal(success.status, "success");
    assert.equal(success.outputs.savingsBalance, "$915.40");

    const notFoundSurface = new PlaywrightSurface({ headless: true });
    const notFound = await replayCapability({
      artifact,
      inputs: { memberId: "40404" },
      surface: notFoundSurface,
      logger: new JsonlRunLogger(join(root, "not-found.jsonl"), redactorFor("40404")),
      evidenceDir: join(root, "replay"),
      entryUrl,
    });
    await notFoundSurface.close();
    assert.equal(notFound.status, "business_outcome");
    assert.equal(notFound.code, "MEMBER_NOT_FOUND");

    const deniedSurface = new PlaywrightSurface({ headless: true });
    const denied = await replayCapability({
      artifact,
      inputs: { memberId: "90000" },
      surface: deniedSurface,
      logger: new JsonlRunLogger(join(root, "denied.jsonl"), redactorFor("90000")),
      evidenceDir: join(root, "replay"),
      entryUrl,
    });
    await deniedSurface.close();
    assert.equal(denied.status, "failure");
    assert.equal(denied.code, "PERMISSION_DENIED");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("operator bridge controls and resumes the same live browser page", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-test-"));
  const server = await startTargetServer(port + 1);
  const surface = new PlaywrightSurface({ headless: true });
  const logger = new JsonlRunLogger(join(root, "handoff.jsonl"), redactorFor("10001"));
  try {
    await surface.start(`http://127.0.0.1:${port + 1}/app`);
    await surface.activePage.getByLabel("Member number").click();
    const bridge = new OperatorBridge(surface.activePage, logger, 4391);
    await bridge.start();
    const intervention = bridge.requestIntervention({
      id: "test-request",
      runId: "test-run",
      capabilityId: "test-capability",
      goal: "Enter a synthetic member number",
      stepId: "step-01",
      reason: "Test control transfer",
      currentUrl: surface.currentUrl(),
      createdAt: new Date().toISOString(),
    });
    await fetch(`${bridge.url}/api/take-control`, { method: "POST", body: "{}" });
    await fetch(`${bridge.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "type", text: "10001" }),
    });
    await fetch(`${bridge.url}/api/resume`, { method: "POST", body: "{}" });
    const actions = await intervention;
    assert.equal(await surface.activePage.getByLabel("Member number").inputValue(), "10001");
    assert.equal(actions[0]?.detail.content, "[REDACTED]");
    await bridge.close();
  } finally {
    await surface.close();
    server.close();
    await once(server, "close");
  }
});

test("a session-expiry handoff resumes and completes the replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-replay-test-"));
  const server = await startTargetServer(port + 2);
  const artifact = CapabilityArtifactSchema.parse(
    JSON.parse(await readFile("evidence/example-capability.json", "utf8")),
  );
  artifact.target.baseUrl = `http://127.0.0.1:${port + 2}`;
  artifact.policy.allowedOrigins = [artifact.target.baseUrl];
  const surface = new PlaywrightSurface({ headless: true });
  const logger = new JsonlRunLogger(join(root, "handoff-replay.jsonl"), redactorFor("10001"));
  const entryUrl = `${artifact.target.baseUrl}/app?scenario=session-timeout-once`;
  try {
    await surface.start(entryUrl);
    const bridge = new OperatorBridge(surface.activePage, logger, 4392);
    await bridge.start();
    const replay = replayCapability({
      artifact,
      inputs: { memberId: "10001" },
      surface,
      logger,
      evidenceDir: join(root, "evidence"),
      entryUrl,
      operator: bridge,
    });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = (await (await fetch(`${bridge.url}/api/state`)).json()) as { owner: string };
      if (state.owner === "available") break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const take = await fetch(`${bridge.url}/api/take-control`, { method: "POST", body: "{}" });
    assert.equal(take.status, 200);
    const box = await surface.activePage.getByRole("button", { name: "Return to sign in" }).boundingBox();
    assert.ok(box);
    const act = await fetch(`${bridge.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "click", x: box.x + box.width / 2, y: box.y + box.height / 2 }),
    });
    assert.equal(act.status, 200);
    const resume = await fetch(`${bridge.url}/api/resume`, { method: "POST", body: "{}" });
    assert.equal(resume.status, 200);
    const result = await replay;
    assert.equal(result.status, "success");
    assert.equal(result.outputs.savingsBalance, "$4,281.17");
    await bridge.close();
  } finally {
    await surface.close();
    server.close();
    await once(server, "close");
  }
});
