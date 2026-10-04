# Evaluator Demo and Replication Guide

This guide provides two paths:

- a five-minute deterministic review that needs no API key; and
- the full discovery demonstration that uses the evaluator's OpenAI API key.

All application data is synthetic.

## 1. Prerequisites

- Node.js 20 or newer
- npm
- Internet access during dependency and Chromium installation
- An OpenAI API key only for live discovery

On Windows, open PowerShell and enter:

```powershell
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
npm.cmd install
npx.cmd playwright install chromium
```

On macOS or Linux, use `npm` and `npx` instead of `npm.cmd` and `npx.cmd`.

## 2. Fast deterministic review without an API key

### Terminal 1: start the target

```powershell
npm.cmd run target
```

Expected message:

```text
Training target listening at http://127.0.0.1:4173/app
```

You can inspect the application at `http://127.0.0.1:4173/app`.

### Terminal 2: replay the checked-in capability

```powershell
npm.cmd run replay -- --artifact evidence/example-capability.json --member-id 10002 --headed
```

The browser enters member `10002`, searches, opens the matching profile, extracts the current savings balance, and verifies the final success message.

Expected result fields:

```json
{
  "status": "success",
  "code": "OK",
  "outputs": {
    "savingsBalance": "$915.40"
  }
}
```

This is deterministic replay. It requires no OpenAI key and makes no model request.

## 3. Full OpenAI discovery demonstration

Keep the target running in terminal 1. In terminal 2, set the key for the current PowerShell process:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-5.4-mini"
```

`gpt-5.4-mini` is the default, but setting it explicitly ensures an older environment override is not reused.

Run discovery:

```powershell
npm.cmd run discover -- --goal "Look up member 10001 and return the current savings balance" --member-id 10001 --artifact artifacts/lookup-savings.generated.json --headed
```

What happens:

1. Playwright opens the target page.
2. The discovery controller captures a screenshot, visible text, and current controls.
3. The OpenAI planner selects one schema-validated action.
4. Playwright executes that action.
5. The controller records stable locator strategies for the successful action.
6. The loop repeats until the declared output is extracted and the success checkpoint passes.
7. The recorder saves a validated capability artifact.

A successful command prints output similar to:

```json
{
  "artifactPath": "...\\artifacts\\lookup-savings.generated.json",
  "outputs": {
    "savingsBalance": "$4,281.17"
  }
}
```

The generated file is ignored by Git because the filename ends in `.generated.json`. Use it for the local demo without accidentally publishing run-specific evidence.

### Inspect the recorded artifact

```powershell
Get-Content artifacts\lookup-savings.generated.json
```

Confirm the following:

- `capability.discoveredBy.provider` is `openai`;
- the model and discovery run ID are recorded;
- the fill step contains `"value": "{{memberId}}"`;
- the extract step declares `savingsBalance`;
- policy allowlists the local origin, paths, and action types; and
- no API key, runtime balance, or raw member input is persisted.

### Prove record once, replay many

Replay the discovered capability with a different member:

```powershell
npm.cmd run replay -- --artifact artifacts/lookup-savings.generated.json --member-id 10002 --headed
```

Expected result:

```json
{
  "status": "success",
  "code": "OK",
  "outputs": {
    "savingsBalance": "$915.40"
  }
}
```

The OpenAI key can be removed before replay to prove the replay path does not need it:

```powershell
Remove-Item Env:OPENAI_API_KEY
npm.cmd run replay -- --artifact artifacts/lookup-savings.generated.json --member-id 10002
```

## 4. Demonstrate result classification

### Business outcome

```powershell
npm.cmd run replay -- --artifact evidence/example-capability.json --member-id 40404
```

Expected:

```text
status: business_outcome
code: MEMBER_NOT_FOUND
```

The application is working correctly. The requested member simply does not exist.

### Hard permission failure

```powershell
npm.cmd run replay -- --artifact evidence/example-capability.json --member-id 90000
```

Expected:

```text
status: failure
code: PERMISSION_DENIED
```

The result includes a failure screenshot path.

### Input contract failure

```powershell
npm.cmd run replay -- --artifact evidence/example-capability.json --member-id abc
```

Expected:

```text
status: failure
code: REPLAY_SETUP_FAILED
```

The invalid value is rejected before browser interaction because the artifact requires exactly five digits.

## 5. Demonstrate human handoff

Run:

```powershell
npm.cmd run replay -- --artifact evidence/example-capability.json --member-id 10001 --url "http://127.0.0.1:4173/app?scenario=session-timeout-once" --operator --headed
```

The target presents a session-expiry dialog after the search action. Replay recognizes the recoverable exception and pauses.

The terminal prints an operator URL similar to `http://127.0.0.1:<port>`. Open it in a browser, then:

1. Select **Take control**.
2. In the screenshot, click the **Return to sign in** button.
3. Select **Resume automation**.

The bridge forwards the click to the existing Playwright page. It does not create a new target session. Replay retries the interrupted search step, completes the remaining fixed steps, and returns `success`.

The associated JSONL log records the intervention request, ownership changes, redacted human actions, resume event, retry, and final result.

## 6. Run the automated test suite

```powershell
npm.cmd test
```

Expected:

```text
tests 8
pass 8
fail 0
```

The suite covers:

- artifact schema validation;
- runtime input templating;
- policy enforcement;
- log redaction;
- discovery recording;
- deterministic success;
- member-not-found classification;
- permission failure;
- direct operator control; and
- recovery after human handoff.

Some related assertions share an integration test, which is why the behavior list is longer than the top-level test count.

## 7. Generate evidence for submission

### Repeatable offline evidence

```powershell
npm.cmd run evidence:offline
```

This starts its own target server and uses a deterministic scripted planner. Stop a separately running target first. The output proves recording, replay, classification, and handoff without credentials, but it is not labeled as LLM evidence.

### Genuine OpenAI evidence

Stop any separately running target server, set the key, and run:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-5.4-mini"
npm.cmd run evidence:live
```

The script manages its own target server and creates:

- `evidence/live-capability.json`;
- `evidence/live-discovery.jsonl`;
- `evidence/live-replay.jsonl`;
- `evidence/live-replay-business-outcome.jsonl`;
- `evidence/live-results.json`;
- discovery screenshots; and
- replay failure screenshots where applicable.

Check `live-capability.json` for OpenAI provenance and inspect all screenshots before publishing.

## 8. Stop the application

In the terminal running the target, press `Ctrl+C`.

To check the port on Windows:

```powershell
netstat -ano | findstr :4173
```

The target is stopped if there is no `LISTENING` entry. `TIME_WAIT`, `FIN_WAIT_2`, and `CLOSE_WAIT` entries are closed or closing connections, not a listening server.

If a confirmed listener remains:

```powershell
Stop-Process -Id 12345
```

Replace `12345` with the process ID from the `LISTENING` row. Do not terminate a process based only on a non-listening connection row.

## 9. Troubleshooting

| Symptom | Resolution |
| --- | --- |
| PowerShell blocks `npm.ps1` | Use `npm.cmd` and `npx.cmd` |
| Chromium executable is missing | Run `npx.cmd playwright install chromium` |
| Port 4173 is already in use | Stop the separate target process before an evidence script |
| API key error | Set `OPENAI_API_KEY` in the same terminal that runs discovery |
| Model access error | Set `OPENAI_MODEL` to an accessible compatible model |
| Invalid member input | Supply exactly five digits |
| Replay cannot open the app | Start `npm.cmd run target` and confirm the artifact base URL |
| Mermaid does not render locally | View Markdown on GitHub or use a Mermaid-enabled editor |

## 10. Suggested evaluator order

For the clearest review:

1. Read the root README architecture summary.
2. Run `npm.cmd test`.
3. Run checked-in deterministic replay with member `10002`.
4. Run the not-found and permission scenarios.
5. Run live discovery if an OpenAI key is available.
6. Replay the newly discovered capability with member `10002`.
7. Try the session-expiry handoff.
8. Review `REPORT.md`, this architecture document, and the evidence directory.
