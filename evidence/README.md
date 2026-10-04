# Evidence

This directory contains two evidence classes with explicit provenance.

## Checked-in offline evidence

`npm.cmd run evidence:offline` on Windows, or `npm run evidence:offline` on macOS and Linux, produces:

- `example-capability.json`: typed capability produced from a live Playwright run with the deterministic scripted planner
- `offline-discovery.jsonl`: discovery observations, decisions, and recorded steps
- `offline-replay-success.jsonl`: successful deterministic replay with different input
- `offline-replay-business-outcome.jsonl`: `MEMBER_NOT_FOUND` classification
- `offline-handoff.jsonl`: pause, control transfer, human action audit, resume, retry, and completion
- `offline-handoff-console.png`: operator console attached to the blocked live session
- `offline-results.json`: structured outcomes and provenance
- `offline-discovery/`: discovery screenshots
- `offline-replay/`: failure and exceptional-state screenshots

The scripted planner exists only to make CI and reviewer validation repeatable without credentials. These files do not claim to satisfy the assignment's required genuine LLM discovery run.

## Checked-in live OpenAI evidence

The final evidence set was generated with a genuine OpenAI discovery run using `gpt-5.4-mini`. It contains:

- `live-capability.json`: parameterized artifact with OpenAI model and run provenance
- `live-discovery.jsonl`: complete observe, decide, act, and record audit log
- `live-replay.jsonl`: successful deterministic replay with a different input
- `live-replay-business-outcome.jsonl`: `MEMBER_NOT_FOUND` classification
- `live-results.json`: concise run and outcome summary
- `live-discovery/`: discovery screenshots
- `live-replay/`: exceptional-state screenshot

To regenerate this set, run:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-5.4-mini"
npm.cmd run evidence:live
```

This creates `live-capability.json`, `live-discovery.jsonl`, `live-replay.jsonl`, `live-replay-business-outcome.jsonl`, `live-results.json`, and corresponding screenshots. The artifact's `discoveredBy` block records provider `openai`, the configured model, and the discovery run ID.

All target records are synthetic. Logs redact runtime member values and declared output values. Review screenshots before publishing if the target application is ever replaced with a non-synthetic environment.

Stop any separately running target server before either evidence command. Each script starts and stops its own target server. The final repository must contain genuine OpenAI evidence in this directory because the scripted evidence alone does not satisfy the live discovery requirement.
