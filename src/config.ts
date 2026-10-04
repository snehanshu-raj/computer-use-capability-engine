import type { InputSpec, OutputSpec } from "./core/schema.js";

export const defaultGoal =
  "Look up member 10001 and return their current savings balance.";

export const inputSpecs: Record<string, InputSpec> = {
  memberId: {
    type: "string",
    description: "Five-digit synthetic training member number.",
    required: true,
    pattern: "^\\d{5}$",
    sensitive: true,
    example: null,
  },
};

export const outputSpecs: Record<string, OutputSpec> = {
  savingsBalance: {
    type: "string",
    description: "Current savings balance as displayed by the target application.",
    sensitive: true,
  },
};

export function targetUrl(): string {
  return `http://127.0.0.1:${process.env.TARGET_PORT ?? "4173"}/app`;
}
