import type {
  AgentDecision,
  Observation,
  OutputSpec,
  RecordedAction,
} from "../core/schema.js";

export interface PlannerContext {
  goal: string;
  observation: Observation;
  history: RecordedAction[];
  outputs: Record<string, unknown>;
  outputSpecs: Record<string, OutputSpec>;
}

export interface DiscoveryPlanner {
  readonly provider: string;
  readonly model: string;
  decide(context: PlannerContext): Promise<AgentDecision>;
}
