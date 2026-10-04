import type { AgentDecision, Control } from "../core/schema.js";
import type { DiscoveryPlanner, PlannerContext } from "./planner.js";

function refFor(controls: Control[], predicate: (control: Control) => boolean): string | null {
  return controls.find(predicate)?.ref ?? null;
}

export class ScriptedPlanner implements DiscoveryPlanner {
  readonly provider = "scripted-test";
  readonly model = "deterministic-fixture-v1";

  constructor(private readonly memberId: string) {}

  async decide(context: PlannerContext): Promise<AgentDecision> {
    const controls = context.observation.controls;
    const actions = context.history.map(item => item.step.action);
    if ("savingsBalance" in context.outputs) {
      return this.decision("done", null, null, null, "Requested balance was extracted", true);
    }
    if (context.observation.visibleText.includes("Member savings profile loaded successfully.")) {
      return this.decision(
        "extract",
        refFor(controls, control => control.name.startsWith("$")),
        null,
        "savingsBalance",
        "Read the displayed savings balance",
      );
    }
    const openRef = refFor(controls, control => control.name === "Open member profile");
    if (openRef) {
      return this.decision("click", openRef, null, null, "Open the matching member profile");
    }
    if (!actions.includes("fill")) {
      return this.decision(
        "fill",
        refFor(controls, control => control.label === "Member number"),
        this.memberId,
        null,
        "Enter the requested member number",
      );
    }
    return this.decision(
      "click",
      refFor(controls, control => control.name === "Search member records"),
      null,
      null,
      "Submit the member lookup",
    );
  }

  private decision(
    action: AgentDecision["action"],
    targetRef: string | null,
    value: string | null,
    outputName: string | null,
    reason: string,
    completed = false,
  ): AgentDecision {
    return {
      action,
      targetRef,
      value,
      outputName,
      reason,
      confidence: 1,
      risk: "safe",
      completed,
      requestHuman: action === "escalate",
    };
  }
}
