import { z } from "zod";

export const ActionKindSchema = z.enum([
  "navigate",
  "fill",
  "click",
  "extract",
  "assert",
  "wait",
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const LocatorStrategySchema = z.object({
  kind: z.enum(["role", "label", "placeholder", "text", "css"]),
  value: z.string().min(1),
  role: z.string().nullable().default(null),
  exact: z.boolean().default(true),
});
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;

export const TargetSchema = z.object({
  description: z.string().min(1),
  strategies: z.array(LocatorStrategySchema).min(1),
});
export type Target = z.infer<typeof TargetSchema>;

export const CheckpointSchema = z.object({
  kind: z.enum(["visible_text", "url", "element_visible", "value_matches"]),
  expected: z.string().min(1),
  target: TargetSchema.nullable().default(null),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const StepSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  action: ActionKindSchema,
  description: z.string().min(1),
  target: TargetSchema.nullable().default(null),
  value: z.string().nullable().default(null),
  outputName: z.string().nullable().default(null),
  risk: z.enum(["safe", "risky"]).default("safe"),
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
  checkpoint: CheckpointSchema.nullable().default(null),
});
export type Step = z.infer<typeof StepSchema>;

export const InputSpecSchema = z.object({
  type: z.enum(["string", "integer", "number", "boolean"]),
  description: z.string().min(1),
  required: z.boolean().default(true),
  pattern: z.string().nullable().default(null),
  sensitive: z.boolean().default(false),
  example: z.union([z.string(), z.number(), z.boolean()]).nullable().default(null),
});
export type InputSpec = z.infer<typeof InputSpecSchema>;

export const OutputSpecSchema = z.object({
  type: z.enum(["string", "integer", "number", "boolean"]),
  description: z.string().min(1),
  sensitive: z.boolean().default(false),
});
export type OutputSpec = z.infer<typeof OutputSpecSchema>;

export const ExceptionRuleSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["business_outcome", "recoverable", "hard_failure"]),
  matchText: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  recovery: z.enum(["none", "retry_step", "human_handoff"]).default("none"),
  maxAttempts: z.number().int().min(0).max(3).default(0),
});
export type ExceptionRule = z.infer<typeof ExceptionRuleSchema>;

export const CapabilityArtifactSchema = z.object({
  schemaVersion: z.literal("1.0"),
  capability: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    revision: z.number().int().positive(),
    status: z.enum(["draft", "approved"]),
    createdAt: z.string().datetime(),
    discoveredBy: z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
      runId: z.string().min(1),
    }),
  }),
  target: z.object({
    appId: z.string().min(1),
    vendor: z.string().min(1),
    appVersion: z.string().min(1),
    baseUrl: z.string().url(),
    tenantVariant: z.string().min(1),
    surfaceAdapter: z.string().min(1),
  }),
  inputs: z.record(z.string(), InputSpecSchema),
  outputs: z.record(z.string(), OutputSpecSchema),
  policy: z.object({
    allowedOrigins: z.array(z.string().url()).min(1),
    allowedPathPatterns: z.array(z.string().min(1)).min(1),
    allowedActions: z.array(ActionKindSchema).min(1),
    riskyActionsRequireHuman: z.boolean(),
    sensitiveInputNames: z.array(z.string()),
  }),
  steps: z.array(StepSchema).min(1),
  exceptions: z.array(ExceptionRuleSchema),
  success: CheckpointSchema,
});
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;

export const AgentDecisionSchema = z.object({
  action: z.enum(["navigate", "fill", "click", "extract", "done", "escalate"]),
  targetRef: z.string().nullable(),
  value: z.string().nullable(),
  outputName: z.string().nullable(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["safe", "risky"]),
  completed: z.boolean(),
  requestHuman: z.boolean(),
});
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export const ControlSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  label: z.string(),
  placeholder: z.string(),
  tag: z.string(),
  type: z.string(),
  href: z.string(),
  disabled: z.boolean(),
});
export type Control = z.infer<typeof ControlSchema>;

export const ObservationSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  visibleText: z.string(),
  controls: z.array(ControlSchema),
  screenshotPath: z.string(),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const RunResultSchema = z.object({
  runId: z.string(),
  capabilityId: z.string(),
  status: z.enum(["success", "business_outcome", "failure", "escalated"]),
  code: z.string(),
  message: z.string(),
  outputs: z.record(z.string(), z.unknown()),
  failedStepId: z.string().nullable(),
  expected: z.string().nullable(),
  observed: z.string().nullable(),
  evidence: z.array(z.string()),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export interface RecordedAction {
  step: Step;
  observedUrl: string;
  reason: string;
}
