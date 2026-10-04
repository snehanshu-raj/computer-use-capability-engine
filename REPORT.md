# Design Report

Implementation diagrams and a longer component walkthrough are available in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Exact evaluator commands are in [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

## 1. Architecture

The system is a small TypeScript application with four explicit boundaries: a discovery planner, a surface adapter, a capability artifact, and a replay engine. The discovery planner uses the OpenAI Responses API with Zod Structured Outputs. On each turn it receives the goal, a screenshot, visible text, a compact inventory of controls, and a summary of prior actions. It returns one typed decision. The planner never executes browser code directly.

`PlaywrightSurface` owns perception and actuation for the implemented web surface. It turns visible controls into short-lived references for the model, converts the selected reference into an ordered list of durable locator strategies, and performs the action. The discovery recorder parameterizes input values and saves only the typed steps. This keeps the capability independent from the model transcript.

`replayCapability` is the production path. It loads an artifact, validates caller inputs, checks policy, resolves templates, executes each saved action, classifies known runtime states, extracts declared outputs, and verifies the final checkpoint. It makes no model call. The local Northstar training app supplies a controlled proxy for a legacy banking console, including table layouts, generic markup, and no test IDs.

The implementation stays in one process for clarity and easy review. The boundaries are interfaces rather than services because queues and deployment plumbing would not improve the core demonstration.

## 2. Artifact schema

The Zod schema is versioned as `1.0` and contains the complete calling contract. Capability metadata includes a stable ID, revision, review status, creation time, and discovery provenance. Target metadata identifies the app, vendor, app version, tenant variant, base URL, and surface adapter. Inputs and outputs have types, descriptions, sensitivity flags, and input validation rules.

Each step records an action, human-readable intent, timeout, risk class, optional parameter template, optional output name, and optional checkpoint. A target contains ordered locator strategies. Semantic labels and roles are preferred, with attribute selectors and visible text as fallbacks. Output extraction receives stricter treatment: data-bearing text and accessible names are stripped before persistence, so a balance or member value cannot accidentally become a locator in the artifact.

The artifact also carries its own policy allowlist, exception taxonomy, and final success checkpoint. This lets both a human reviewer and a calling agent answer what the capability does, what it accepts, what it returns, where it may act, and how it can fail. Runtime member values are represented as `{{memberId}}`, never copied into saved steps.

## 3. Determinism & error handling

Replay walks a fixed ordered step list. For each target, the adapter tries saved locator strategies in priority order, requires visibility, applies an explicit timeout, and records the selected action. It does not ask a model to repair or reinterpret a step. The final checkpoint confirms that the savings profile loaded, and replay fails if a declared output was not produced.

The structured result separates three classes. `MEMBER_NOT_FOUND` is a business outcome because the caller needs that answer. Session expiry is recoverable and routes through human handoff, after which the interrupted step is retried once. Permission denial and validation rejection are hard failures. Execution errors capture the failing step, expected state, observed state, and a screenshot path. This classification is more important here than layout drift because the proxy UI is intentionally stable.

The demonstration includes successful replay with a different member, not-found classification, permission failure, and session-expiry recovery. Tests also verify that the model is absent from the replay path.

## 4. Heterogeneity & multi-tenant

The artifact describes actions and target strategies, while `SurfaceAdapter` defines how a surface starts, observes, acts, checks a condition, captures evidence, and reports its current location. A desktop adapter could implement the same contract with Windows UI Automation, the accessibility tree, OCR, or screenshot coordinates. A hostile legacy-web adapter could add frame traversal and table-aware targeting without changing the replay result contract.

For multi-tenant reuse, the capability ID should belong to the vendor workflow, not one institution. The artifact already separates vendor, app version, and tenant variant. A production catalog would keep a reviewed base artifact plus narrowly scoped variant overrides for routes, locators, and known dialogs. A preflight fingerprint could compare window titles, accessibility landmarks, and vendor version text before selecting a compatible revision. Unknown fingerprints would block unattended replay and request review rather than silently applying a tenant-specific guess.

Replay telemetry would feed per-artifact and per-variant stability scores. Repeated locator fallback, checkpoint failures, or a new dialog signature would mark drift. This project models those seams but does not build the catalog or fleet services.

## 5. Escalation & handoff

The operator bridge has an explicit control owner: `automation`, `available`, or `human`. Discovery or replay creates an intervention request with the capability, goal, step, reason, URL, and timestamp. Automation then awaits a resume signal and cannot continue concurrently.

The minimal operator console serves a current screenshot of the same Playwright page. After taking control, the operator can click screenshot coordinates, type into the focused control, and send a small allowlist of keys. These actions are applied to the original target page in the original browser context. Resume returns ownership to automation, records the intervention and human actions, and continues the same run. Typed content is logged only as a character count with the content redacted.

The session-expiry scenario proves the full seam: replay pauses, the operator dismisses the blocking dialog, ownership returns, replay retries the interrupted search, and the remaining deterministic steps complete.

## 6. Safety

Policy is enforced outside the model. The engine validates the origin and path before launch, checks every action type, rechecks location after actions, and requires human approval for steps marked risky. Input schemas reject malformed values before UI interaction. Known runtime values, sensitive keys, authorization data, and bearer tokens are redacted from logs. The saved artifact contains templates rather than invocation values.

The OpenAI request uses `store: false`, and the repository contains no credentials. This flag is not a substitute for an approved provider contract or zero-data-retention configuration. The target and committed screenshots contain synthetic data only. In production, screenshots would still require encryption, access control, retention limits, tenant-scoped storage, and a redaction boundary appropriate to the selected perception method. The demo operator service binds only to localhost, but it has no authentication and must not be exposed to a network.

The model can propose only typed single-step actions against visible control references. An untrusted model response still passes through schema validation, target resolution, and policy before it reaches Playwright.

## 7. Cuts

The implementation deliberately omits distributed queues, a database-backed catalog, operator authentication, real bank integrations, artifact signing, and tenant deployment infrastructure. It implements only a web adapter. The operator console favors a minimal screenshot control surface over real-time video. Artifact approval is represented by status but not enforced as a release workflow. The live OpenAI evidence command requires the submitter's own API key because secrets are never bundled.

With more time, the next work would be artifact approval and signing, authenticated operator sessions, encrypted evidence retention, a Windows accessibility adapter, variant overlays with preflight fingerprints, and repeated replay scoring. A bounded model-assisted single-step recovery would come later and would remain behind the same policy checks and evidence trail.
