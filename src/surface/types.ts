import type {
  AgentDecision,
  Checkpoint,
  Observation,
  Step,
  Target,
} from "../core/schema.js";

export interface StepExecution {
  value: string | null;
  observed: string;
}

export interface SurfaceAdapter {
  readonly kind: string;
  start(entryUrl: string): Promise<void>;
  observe(evidenceDir: string, sequence: number): Promise<Observation>;
  decisionToStep(decision: AgentDecision, observation: Observation, sequence: number): Step;
  execute(step: Step, resolvedValue: string | null): Promise<StepExecution>;
  check(checkpoint: Checkpoint): Promise<{ passed: boolean; observed: string }>;
  visibleText(): Promise<string>;
  currentUrl(): string;
  screenshot(path: string): Promise<void>;
  close(): Promise<void>;
}
