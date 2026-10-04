import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { JsonlRunLogger } from "../core/logger.js";
import { PolicyEngine } from "../core/policy.js";
import type {
  CapabilityArtifact,
  ExceptionRule,
  RunResult,
  Step,
} from "../core/schema.js";
import { resolveTemplate, validateInputs } from "../core/templates.js";
import type { InterventionRequest, OperatorBridge } from "../handoff/operator-bridge.js";
import type { SurfaceAdapter } from "../surface/types.js";

export interface ReplayConfig {
  artifact: CapabilityArtifact;
  inputs: Record<string, unknown>;
  surface: SurfaceAdapter;
  logger: JsonlRunLogger;
  evidenceDir: string;
  entryUrl?: string;
  operator?: OperatorBridge;
}

interface ExceptionMatch {
  rule: ExceptionRule;
  observed: string;
}

export async function replayCapability(config: ReplayConfig): Promise<RunResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const policy = new PolicyEngine(config.artifact);
  const outputs: Record<string, unknown> = {};
  const evidence: string[] = [];
  const entryUrl = config.entryUrl ?? `${config.artifact.target.baseUrl}/app`;

  try {
    validateInputs(config.artifact.inputs, config.inputs);
    policy.assertUrlAllowed(entryUrl);
    await config.surface.start(entryUrl);
    await config.logger.log({
      runId,
      type: "replay_started",
      data: {
        capabilityId: config.artifact.capability.id,
        revision: config.artifact.capability.revision,
        inputNames: Object.keys(config.inputs),
      },
    });

    for (const step of config.artifact.steps) {
      policy.assertUrlAllowed(config.surface.currentUrl());
      policy.assertActionAllowed(step.action);
      if (policy.requiresHuman(step)) {
        if (!config.operator) {
          return await finish(
            config,
            runId,
            startedAt,
            outputs,
            evidence,
            "escalated",
            "HUMAN_APPROVAL_REQUIRED",
            `Risky step requires human approval: ${step.description}`,
            step.id,
            "human approval",
            "no operator bridge configured",
          );
        }
        await handoff(config, runId, step, `Risky action requires approval: ${step.description}`);
      }

      await config.logger.log({
        runId,
        type: "step_started",
        stepId: step.id,
        data: { action: step.action, description: step.description },
      });

      const value = step.value === null ? null : resolveTemplate(step.value, config.inputs);
      try {
        const execution = await config.surface.execute(step, value);
        if (step.action === "extract" && step.outputName) outputs[step.outputName] = execution.value;
        if (step.checkpoint) {
          const checkpoint = await config.surface.check(step.checkpoint);
          if (!checkpoint.passed) {
            throw new Error(`Step checkpoint failed: ${checkpoint.observed}`);
          }
        }
        await config.logger.log({
          runId,
          type: "step_completed",
          stepId: step.id,
          data: {
            action: step.action,
            observed: step.action === "extract" ? "[DECLARED_OUTPUT]" : execution.observed,
          },
        });
      } catch (error) {
        const path = await captureFailure(config, runId, step.id);
        evidence.push(path);
        return await finish(
          config,
          runId,
          startedAt,
          outputs,
          evidence,
          "failure",
          "STEP_EXECUTION_FAILED",
          error instanceof Error ? error.message : String(error),
          step.id,
          step.description,
          await config.surface.visibleText(),
        );
      }

      let matched = await detectException(config);
      if (matched?.rule.category === "recoverable" && matched.rule.recovery === "human_handoff") {
        if (!config.operator) {
          const path = await captureFailure(config, runId, step.id);
          evidence.push(path);
          return await finish(
            config,
            runId,
            startedAt,
            outputs,
            evidence,
            "escalated",
            matched.rule.code,
            matched.rule.message,
            step.id,
            "human recovery",
            matched.observed,
          );
        }
        await handoff(config, runId, step, matched.rule.message);
        matched = await detectException(config);
        if (!matched) {
          await config.logger.log({
            runId,
            type: "recovery_retry_started",
            stepId: step.id,
            data: { exceptionCode: "SESSION_EXPIRED" },
          });
          const retried = await config.surface.execute(step, value);
          if (step.action === "extract" && step.outputName) outputs[step.outputName] = retried.value;
          matched = await detectException(config);
        }
      }
      if (matched) {
        const path = await captureFailure(config, runId, step.id);
        evidence.push(path);
        const status = matched.rule.category === "business_outcome" ? "business_outcome" : "failure";
        return await finish(
          config,
          runId,
          startedAt,
          outputs,
          evidence,
          status,
          matched.rule.code,
          matched.rule.message,
          step.id,
          "no exceptional state",
          matched.observed,
        );
      }
      policy.assertUrlAllowed(config.surface.currentUrl());
    }

    const missingOutputs = Object.keys(config.artifact.outputs).filter(name => !(name in outputs));
    if (missingOutputs.length > 0) {
      const path = await captureFailure(config, runId, "final");
      evidence.push(path);
      return await finish(
        config,
        runId,
        startedAt,
        outputs,
        evidence,
        "failure",
        "MISSING_OUTPUT",
        `Replay completed without outputs: ${missingOutputs.join(", ")}`,
        null,
        missingOutputs.join(", "),
        Object.keys(outputs).join(", "),
      );
    }
    const checkpoint = await config.surface.check(config.artifact.success);
    if (!checkpoint.passed) {
      const path = await captureFailure(config, runId, "final");
      evidence.push(path);
      return await finish(
        config,
        runId,
        startedAt,
        outputs,
        evidence,
        "failure",
        "SUCCESS_CHECKPOINT_FAILED",
        "Replay did not reach the declared success checkpoint.",
        null,
        config.artifact.success.expected,
        checkpoint.observed,
      );
    }
    return await finish(
      config,
      runId,
      startedAt,
      outputs,
      evidence,
      "success",
      "OK",
      "Capability replay completed successfully.",
      null,
      config.artifact.success.expected,
      checkpoint.observed,
    );
  } catch (error) {
    return await finish(
      config,
      runId,
      startedAt,
      outputs,
      evidence,
      "failure",
      "REPLAY_SETUP_FAILED",
      error instanceof Error ? error.message : String(error),
      null,
      null,
      null,
    );
  }
}

async function detectException(config: ReplayConfig): Promise<ExceptionMatch | null> {
  const observed = await config.surface.visibleText();
  const rule = config.artifact.exceptions.find(candidate => observed.includes(candidate.matchText));
  return rule ? { rule, observed: observed.slice(0, 1_000) } : null;
}

async function handoff(
  config: ReplayConfig,
  runId: string,
  step: Step,
  reason: string,
): Promise<void> {
  const request: InterventionRequest = {
    id: randomUUID(),
    runId,
    capabilityId: config.artifact.capability.id,
    goal: config.artifact.capability.description,
    stepId: step.id,
    reason,
    currentUrl: config.surface.currentUrl(),
    createdAt: new Date().toISOString(),
  };
  await config.operator?.requestIntervention(request);
}

async function captureFailure(
  config: ReplayConfig,
  runId: string,
  stepId: string,
): Promise<string> {
  const path = join(config.evidenceDir, `${runId}-${stepId}-failure.png`);
  await config.surface.screenshot(path);
  await config.logger.log({ runId, type: "failure_evidence_captured", stepId, data: { path } });
  return path;
}

async function finish(
  config: ReplayConfig,
  runId: string,
  startedAt: string,
  outputs: Record<string, unknown>,
  evidence: string[],
  status: RunResult["status"],
  code: string,
  message: string,
  failedStepId: string | null,
  expected: string | null,
  observed: string | null,
): Promise<RunResult> {
  const result: RunResult = {
    runId,
    capabilityId: config.artifact.capability.id,
    status,
    code,
    message,
    outputs,
    failedStepId,
    expected,
    observed,
    evidence,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  await config.logger.log({
    runId,
    type: "replay_finished",
    data: {
      capabilityId: result.capabilityId,
      status: result.status,
      code: result.code,
      message: result.message,
      outputNames: Object.keys(outputs),
      failedStepId: result.failedStepId,
      evidence: result.evidence,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    },
  });
  return result;
}
