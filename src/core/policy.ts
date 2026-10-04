import type { ActionKind, CapabilityArtifact, Step } from "./schema.js";

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolation";
  }
}

function pathPatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export class PolicyEngine {
  constructor(private readonly artifact: CapabilityArtifact) {}

  assertUrlAllowed(rawUrl: string): void {
    const url = new URL(rawUrl);
    if (!this.artifact.policy.allowedOrigins.includes(url.origin)) {
      throw new PolicyViolation(`Origin is not allowlisted: ${url.origin}`);
    }
    if (
      !this.artifact.policy.allowedPathPatterns.some(pattern =>
        pathPatternToRegex(pattern).test(url.pathname),
      )
    ) {
      throw new PolicyViolation(`Path is not allowlisted: ${url.pathname}`);
    }
  }

  assertActionAllowed(action: ActionKind): void {
    if (!this.artifact.policy.allowedActions.includes(action)) {
      throw new PolicyViolation(`Action is not allowlisted: ${action}`);
    }
  }

  requiresHuman(step: Step): boolean {
    return step.risk === "risky" && this.artifact.policy.riskyActionsRequireHuman;
  }
}
