import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JsonlRunLogger } from "../core/logger.js";
import {
  type ActionKind,
  CapabilityArtifactSchema,
  type CapabilityArtifact,
  type Checkpoint,
  type InputSpec,
  type OutputSpec,
  type RecordedAction,
} from "../core/schema.js";
import type { InterventionRequest, OperatorBridge } from "../handoff/operator-bridge.js";
import type { SurfaceAdapter } from "../surface/types.js";
import type { DiscoveryPlanner } from "./planner.js";

export interface DiscoveryConfig {
  goal: string;
  entryUrl: string;
  inputs: Record<string, unknown>;
  inputSpecs: Record<string, InputSpec>;
  outputSpecs: Record<string, OutputSpec>;
  planner: DiscoveryPlanner;
  surface: SurfaceAdapter;
  logger: JsonlRunLogger;
  evidenceDir: string;
  artifactPath: string;
  maxSteps?: number;
  timeoutMs?: number;
  operator?: OperatorBridge;
  policy?: {
    allowedOrigins: string[];
    allowedPathPatterns: string[];
    allowedActions: ActionKind[];
  };
}

export interface DiscoveryResult {
  runId: string;
  artifact: CapabilityArtifact;
  outputs: Record<string, unknown>;
}

function parameterize(value: string | null, inputs: Record<string, unknown>): string | null {
  if (value === null) return null;
  for (const [name, input] of Object.entries(inputs)) {
    if (value === String(input)) return `{{${name}}}`;
  }
  return value;
}

function defaultSuccess(): Checkpoint {
  return {
    kind: "visible_text",
    expected: "Member savings profile loaded successfully.",
    target: null,
  };
}

export async function discoverCapability(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const runId = randomUUID();
  const startedAt = Date.now();
  const maxSteps = config.maxSteps ?? 12;
  const timeoutMs = config.timeoutMs ?? 300_000;
  const history: RecordedAction[] = [];
  const outputs: Record<string, unknown> = {};
  const discoveryPolicy = getDiscoveryPolicy(config);
  await mkdir(config.evidenceDir, { recursive: true });
  await config.surface.start(config.entryUrl);
  await config.logger.log({
    runId,
    type: "discovery_started",
    data: {
      goal: redactGoal(config.goal, config.inputs),
      targetOrigin: new URL(config.entryUrl).origin,
      plannerProvider: config.planner.provider,
      plannerModel: config.planner.model,
    },
  });

  for (let sequence = 1; sequence <= maxSteps; sequence += 1) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Discovery timed out");
    assertDiscoveryUrl(config.surface.currentUrl(), discoveryPolicy);
    const observation = await config.surface.observe(config.evidenceDir, sequence);
    await config.logger.log({
      runId,
      type: "observation",
      data: {
        sequence,
        url: observation.url,
        title: observation.title,
        controlCount: observation.controls.length,
        screenshotPath: observation.screenshotPath,
      },
    });
    let decision = await config.planner.decide({
      goal: config.goal,
      observation,
      history,
      outputs,
      outputSpecs: config.outputSpecs,
    });
    if (decision.action === "extract" && !((decision.outputName ?? "") in config.outputSpecs)) {
      const declaredOutputNames = Object.keys(config.outputSpecs);
      if (declaredOutputNames.length !== 1) {
        throw new Error(
          `Planner used undeclared output: ${decision.outputName ?? "null"}. Expected one of: ${declaredOutputNames.join(", ")}`,
        );
      }
      const normalizedOutputName = declaredOutputNames[0] as string;
      await config.logger.log({
        runId,
        type: "planner_output_normalized",
        data: {
          proposedOutputName: decision.outputName,
          normalizedOutputName,
        },
      });
      decision = { ...decision, outputName: normalizedOutputName };
    }
    if (decision.action !== "extract" && decision.outputName !== null) {
      decision = { ...decision, outputName: null };
    }
    const safeDecisionReason =
      decision.action === "extract"
        ? `Extract declared output ${decision.outputName ?? "value"}`
        : sanitizeRuntimeText(decision.reason, config.inputs, outputs);
    await config.logger.log({
      runId,
      type: "planner_decision",
      data: {
        action: decision.action,
        targetRef: decision.targetRef,
        outputName: decision.outputName,
        reason: safeDecisionReason,
        confidence: decision.confidence,
        risk: decision.risk,
      },
    });

    if (decision.action === "escalate" || decision.requestHuman) {
      if (!config.operator) throw new Error(`Human intervention required: ${safeDecisionReason}`);
      const request: InterventionRequest = {
        id: randomUUID(),
        runId,
        capabilityId: "discovery-in-progress",
        goal: redactGoal(config.goal, config.inputs),
        stepId: null,
        reason: safeDecisionReason,
        currentUrl: config.surface.currentUrl(),
        createdAt: new Date().toISOString(),
      };
      await config.operator.requestIntervention(request);
      continue;
    }

    if (decision.action === "done" || decision.completed) {
      const missingOutputs = Object.keys(config.outputSpecs).filter(name => !(name in outputs));
      if (missingOutputs.length > 0) {
        throw new Error(`Planner ended before extracting outputs: ${missingOutputs.join(", ")}`);
      }
      const checkpoint = await config.surface.check(defaultSuccess());
      if (!checkpoint.passed) {
        throw new Error(`Planner ended before success checkpoint: ${checkpoint.observed}`);
      }
      const artifact = buildArtifact(config, runId, history);
      await mkdir(dirname(config.artifactPath), { recursive: true });
      await writeFile(config.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      await config.logger.log({
        runId,
        type: "discovery_completed",
        data: { artifactPath: config.artifactPath, stepCount: history.length },
      });
      return { runId, artifact, outputs };
    }

    const step = config.surface.decisionToStep(decision, observation, sequence);
    if (!discoveryPolicy.allowedActions.includes(step.action)) {
      throw new Error(`Discovery action is not allowlisted: ${step.action}`);
    }
    step.value = parameterize(step.value, config.inputs);
    step.description =
      step.action === "extract"
        ? `Extract declared output ${step.outputName ?? "value"}`
        : sanitizeRuntimeText(step.description, config.inputs, outputs);
    const executionValue = decision.value;
    if (step.action === "navigate" && executionValue) {
      assertDiscoveryUrl(executionValue, discoveryPolicy);
    }
    const execution = await config.surface.execute(step, executionValue);
    assertDiscoveryUrl(config.surface.currentUrl(), discoveryPolicy);
    if (step.action === "extract") {
      if (!step.outputName) throw new Error("Extract decision is missing outputName");
      if (!(step.outputName in config.outputSpecs)) {
        throw new Error(`Planner used undeclared output: ${step.outputName}`);
      }
      outputs[step.outputName] = execution.value;
    }
    history.push({ step, observedUrl: observation.url, reason: safeDecisionReason });
    await config.logger.log({
      runId,
      type: "action_completed",
      stepId: step.id,
      data: { step, observed: step.action === "extract" ? "[DECLARED_OUTPUT]" : execution.observed },
    });
  }
  throw new Error(`Discovery stopped after ${maxSteps} steps`);
}

function redactGoal(goal: string, inputs: Record<string, unknown>): string {
  let safe = goal;
  for (const [name, value] of Object.entries(inputs)) {
    safe = safe.replaceAll(String(value), `[REDACTED:${name}]`);
  }
  return safe;
}

function sanitizeRuntimeText(
  text: string,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
): string {
  let safe = text;
  for (const [name, value] of Object.entries(inputs)) {
    safe = safe.replaceAll(String(value), `{{${name}}}`);
  }
  for (const [name, value] of Object.entries(outputs)) {
    if (value !== null && value !== undefined && String(value)) {
      safe = safe.replaceAll(String(value), `[OUTPUT:${name}]`);
    }
  }
  return safe;
}

function buildArtifact(
  config: DiscoveryConfig,
  runId: string,
  history: RecordedAction[],
): CapabilityArtifact {
  const base = new URL(config.entryUrl);
  const discoveryPolicy = getDiscoveryPolicy(config);
  return CapabilityArtifactSchema.parse({
    schemaVersion: "1.0",
    capability: {
      id: "northstar.lookup-savings-balance",
      name: "Lookup savings balance",
      description: "Find a synthetic training member and return the current savings balance.",
      revision: 1,
      status: "draft",
      createdAt: new Date().toISOString(),
      discoveredBy: {
        provider: config.planner.provider,
        model: config.planner.model,
        runId,
      },
    },
    target: {
      appId: "northstar-core-training",
      vendor: "Northstar Demo Systems",
      appVersion: "1.0",
      baseUrl: base.origin,
      tenantVariant: "training-default",
      surfaceAdapter: config.surface.kind,
    },
    inputs: config.inputSpecs,
    outputs: config.outputSpecs,
    policy: {
      allowedOrigins: discoveryPolicy.allowedOrigins,
      allowedPathPatterns: discoveryPolicy.allowedPathPatterns,
      allowedActions: discoveryPolicy.allowedActions,
      riskyActionsRequireHuman: true,
      sensitiveInputNames: Object.entries(config.inputSpecs)
        .filter(([, spec]) => spec.sensitive)
        .map(([name]) => name),
    },
    steps: history.map(item => item.step),
    exceptions: [
      {
        id: "member-not-found",
        category: "business_outcome",
        matchText: "No member found for number",
        code: "MEMBER_NOT_FOUND",
        message: "No matching member exists.",
        recovery: "none",
        maxAttempts: 0,
      },
      {
        id: "session-expired",
        category: "recoverable",
        matchText: "Session expired",
        code: "SESSION_EXPIRED",
        message: "The session expired and requires human reauthentication.",
        recovery: "human_handoff",
        maxAttempts: 1,
      },
      {
        id: "permission-denied",
        category: "hard_failure",
        matchText: "Permission denied",
        code: "PERMISSION_DENIED",
        message: "The current operator is not permitted to view this member.",
        recovery: "none",
        maxAttempts: 0,
      },
      {
        id: "validation-error",
        category: "hard_failure",
        matchText: "Validation error",
        code: "VALIDATION_ERROR",
        message: "The target application rejected the supplied input.",
        recovery: "none",
        maxAttempts: 0,
      },
    ],
    success: defaultSuccess(),
  });
}

function getDiscoveryPolicy(config: DiscoveryConfig): NonNullable<DiscoveryConfig["policy"]> {
  return (
    config.policy ?? {
      allowedOrigins: [new URL(config.entryUrl).origin],
      allowedPathPatterns: ["/", "/app"],
      allowedActions: ["navigate", "fill", "click", "extract", "assert", "wait"],
    }
  );
}

function assertDiscoveryUrl(
  rawUrl: string,
  policy: NonNullable<DiscoveryConfig["policy"]>,
): void {
  const url = new URL(rawUrl);
  if (!policy.allowedOrigins.includes(url.origin)) {
    throw new Error(`Discovery origin is not allowlisted: ${url.origin}`);
  }
  const pathAllowed = policy.allowedPathPatterns.some(pattern => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(url.pathname);
  });
  if (!pathAllowed) throw new Error(`Discovery path is not allowlisted: ${url.pathname}`);
}
