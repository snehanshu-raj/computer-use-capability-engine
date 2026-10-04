import type { InputSpec } from "./schema.js";

const templatePattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function resolveTemplate(value: string, inputs: Record<string, unknown>): string {
  return value.replace(templatePattern, (_, name: string) => {
    if (!(name in inputs)) {
      throw new Error(`Missing template input: ${name}`);
    }
    return String(inputs[name]);
  });
}

export function validateInputs(
  specs: Record<string, InputSpec>,
  inputs: Record<string, unknown>,
): void {
  for (const [name, spec] of Object.entries(specs)) {
    const value = inputs[name];
    if (spec.required && (value === undefined || value === null || value === "")) {
      throw new Error(`Missing required input: ${name}`);
    }
    if (value === undefined || value === null) continue;

    const actualType = typeof value;
    if (spec.type === "integer" && (actualType !== "number" || !Number.isInteger(value))) {
      throw new Error(`Input ${name} must be an integer`);
    }
    if (spec.type === "number" && actualType !== "number") {
      throw new Error(`Input ${name} must be a number`);
    }
    if (spec.type === "boolean" && actualType !== "boolean") {
      throw new Error(`Input ${name} must be a boolean`);
    }
    if (spec.type === "string" && actualType !== "string") {
      throw new Error(`Input ${name} must be a string`);
    }
    if (spec.pattern && !new RegExp(spec.pattern).test(String(value))) {
      throw new Error(`Input ${name} does not match the required pattern`);
    }
  }
}
