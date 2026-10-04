import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PolicyEngine, PolicyViolation } from "../src/core/policy.js";
import { Redactor } from "../src/core/redaction.js";
import { CapabilityArtifactSchema } from "../src/core/schema.js";
import { resolveTemplate, validateInputs } from "../src/core/templates.js";

test("the example artifact is typed, versioned, and reviewable", async () => {
  const artifact = CapabilityArtifactSchema.parse(
    JSON.parse(await readFile("evidence/example-capability.json", "utf8")),
  );
  assert.equal(artifact.schemaVersion, "1.0");
  assert.ok(artifact.steps.length >= 4);
  assert.equal(artifact.steps[0]?.value, "{{memberId}}");
  assert.equal(artifact.success.kind, "visible_text");
});

test("templates resolve declared inputs and reject missing values", () => {
  assert.equal(resolveTemplate("member={{memberId}}", { memberId: "10001" }), "member=10001");
  assert.throws(() => resolveTemplate("{{missing}}", {}), /Missing template input/);
});

test("input contracts validate types and patterns", () => {
  const specs = {
    memberId: {
      type: "string" as const,
      description: "Member number",
      required: true,
      pattern: "^\\d{5}$",
      sensitive: true,
      example: null,
    },
  };
  assert.doesNotThrow(() => validateInputs(specs, { memberId: "10001" }));
  assert.throws(() => validateInputs(specs, { memberId: "abc" }), /required pattern/);
});

test("policy blocks origins, paths, and actions outside the allowlist", async () => {
  const artifact = CapabilityArtifactSchema.parse(
    JSON.parse(await readFile("evidence/example-capability.json", "utf8")),
  );
  const policy = new PolicyEngine(artifact);
  assert.doesNotThrow(() => policy.assertUrlAllowed("http://127.0.0.1:4173/app"));
  assert.throws(
    () => policy.assertUrlAllowed("https://example.com/app"),
    PolicyViolation,
  );
  assert.throws(
    () => policy.assertUrlAllowed("http://127.0.0.1:4173/admin"),
    PolicyViolation,
  );
  const riskyStep = { ...artifact.steps[1]!, risk: "risky" as const };
  assert.equal(policy.requiresHuman(riskyStep), true);
});

test("redaction removes sensitive keys, bearer tokens, and runtime values", () => {
  const redactor = new Redactor(new Set(["memberId"]), new Set(["10001"]));
  const safe = redactor.redact({
    memberId: "10001",
    note: "member 10001",
    authorization: "Bearer secret-token",
  });
  assert.deepEqual(safe, {
    memberId: "[REDACTED]",
    note: "member [REDACTED]",
    authorization: "[REDACTED]",
  });
});
