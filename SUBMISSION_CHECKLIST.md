# Submission Checklist

The assignment requires a public GitHub repository. Do not submit a ZIP file.

## 1. Required repository contents

- [x] `/README.md` with setup instructions and exact discovery plus replay commands
- [x] `/REPORT.md` with the seven required headings in the required order
- [x] Source code for discovery, recording, deterministic replay, policy, logging, and handoff
- [x] A checked-in example capability artifact
- [x] Offline discovery, replay, exception, and handoff evidence
- [x] Tests covering the core contract and end-to-end behavior
- [x] Genuine OpenAI discovery evidence under `/evidence/`
- [x] Final secret and screenshot review
- [ ] Public GitHub repository URL

The checked-in live evidence was generated with OpenAI model `gpt-5.4-mini`. The offline evidence remains intentionally labeled as scripted and provides credential-free reproducibility plus handoff evidence.

## 2. Generate final live evidence

First stop any terminal currently running `npm.cmd run target`. The evidence script manages its own server.

In PowerShell:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-5.4-mini"
npm.cmd run evidence:live
```

Expected files:

```text
evidence/live-capability.json
evidence/live-discovery.jsonl
evidence/live-replay.jsonl
evidence/live-replay-business-outcome.jsonl
evidence/live-results.json
evidence/live-discovery/
evidence/live-replay/
```

Confirm that:

- `live-capability.json` records provider `openai`, the selected model, and a run ID;
- `live-discovery.jsonl` contains observations, planner decisions, completed actions, and completion;
- `live-replay.jsonl` finishes with `success / OK`;
- `live-replay-business-outcome.jsonl` finishes with `business_outcome / MEMBER_NOT_FOUND`;
- the artifact contains `{{memberId}}`, not the runtime member number;
- output values are absent from artifacts and JSONL event payloads;
- screenshots contain only the included synthetic records; and
- no key or authorization token appears anywhere.

Do not publish the older ad hoc logs under `runs/`. That directory is ignored because development runs can contain superseded or less strictly sanitized evidence.

## 3. Run final verification

```powershell
npm.cmd test
npm.cmd run typecheck
```

Expected test summary:

```text
tests 8
pass 8
fail 0
```

Run the checked-in capability once:

```powershell
$projectPath = (Get-Location).Path
$targetJob = Start-Job -ScriptBlock {
  param($path)
  Set-Location $path
  npm.cmd run target
} -ArgumentList $projectPath
Start-Sleep -Seconds 2
npm.cmd run replay -- --artifact evidence/example-capability.json --member-id 10002
Stop-Job $targetJob
Remove-Job $targetJob
```

Expected replay result: `success / OK` with `savingsBalance` equal to `$915.40`.

## 4. Review for secrets and unwanted files

Never commit `.env`, API keys, browser profiles, `node_modules`, `dist`, or temporary run output.

Before staging:

```powershell
git status --short
git check-ignore .env node_modules dist runs
```

After staging, scan the staged patch:

```powershell
git diff --cached --check
git diff --cached
```

Read the full staged diff. Search for common secret markers:

```powershell
git grep -n -I -E "sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY[[:space:]]*="
```

An instructional line such as `OPENAI_API_KEY = "your-key"` is a placeholder, not a secret. Any real key must be removed and rotated before publication.

Also confirm that `tmp/` is not staged. It contains local PDF review files and is not part of the submission.

## 5. Inspect the reviewer path

Open the repository as if you were the evaluator and verify this order:

1. The root README explains the purpose without requiring prior context.
2. The architecture Mermaid diagram renders on GitHub.
3. Setup begins from a clean clone.
4. The no-key replay path is immediately visible.
5. The genuine OpenAI discovery command is exact and copyable.
6. `REPORT.md` is concise and uses exactly the seven required headings.
7. `evidence/README.md` clearly distinguishes scripted evidence from genuine OpenAI evidence.
8. Evidence includes a saved artifact, discovery log, successful replay log, and exceptional replay log.
9. Known limitations and production gaps are explicit.

## 6. Publish to a public GitHub repository

Create an empty public repository on GitHub without adding a README, license, or `.gitignore` there. Then run:

```powershell
git add .
git status --short
git commit -m "Build record-once replay-many computer-use system"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

If `origin` already exists, inspect it instead of adding another:

```powershell
git remote -v
```

Verify the public repository in a private browser window. Check that:

- the repository opens without authentication;
- the README diagrams render;
- `REPORT.md` and `evidence/` are present;
- no secrets are visible; and
- the clone and setup commands work from the public URL.

## 7. Submit by email

Send the public repository link to `assignments@interface.ai` from the email address used for the application.

Suggested subject:

```text
Computer-Use Automation System Submission - Snehanshu Raj
```

Suggested body:

```text
Hello Interface.ai Engineering Team,

Please find my Computer-Use Automation System take-home submission below.

https://github.com/YOUR-USERNAME/YOUR-REPOSITORY

The repository includes the working TypeScript implementation, exact setup and demo commands, the required design report, and discovery plus replay evidence.

Best,
Snehanshu Raj
```

Keep the repository URL on its own line. Do not attach a ZIP file.

## 8. Be ready to explain

Prepare a short explanation for each of these reviewer questions:

1. Why is the LLM limited to discovery?
2. Why is the artifact more than a recorded click list?
3. How are runtime values parameterized and redacted?
4. How does replay distinguish a business outcome from a failure?
5. What makes locator targeting reasonably robust?
6. What prevents the model or replay engine from leaving the allowlisted target?
7. How does the operator control the same live session?
8. How would `SurfaceAdapter` extend to legacy web or desktop automation?
9. How would vendor artifacts be reused and specialized across tenants?
10. What was deliberately cut, and what would be built next?

The concise answers are in `REPORT.md`; the deeper implementation explanation and diagrams are in `docs/ARCHITECTURE.md`.
