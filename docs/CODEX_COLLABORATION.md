# Codex collaboration record

MittiGuard was created in Codex using GPT-5.6 during OpenAI Build Week. This document makes the collaboration visible without overstating what the runtime model does.

## Where Codex accelerated the work

1. **Product framing.** Codex helped turn a broad agriculture problem into a narrow dealer workflow: stop an unsupported input sale, create a review case, and remember the unresolved field outcome. The decisive product choice was to avoid disease diagnosis and product recommendation entirely.
2. **Safety architecture.** Codex helped separate model language from consequential state. `lib/policy.mjs` is the only component that can create `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`; there is no approved-sale state.
3. **Working full-stack build.** Codex accelerated the Node server, persistent local ledger, weather context, image intake, responsive case-desk UI, review queue, and field-memory views.
4. **Evaluation design.** Codex helped write the eight deterministic fixtures, the isolated persistence test, the live-model smoke check, and the model-output guard test. These tests support MittiGuard's limited claim: ambiguity never becomes automated product authorization.
5. **Runtime resilience.** When an OpenAI API account did not have API quota, Codex refactored the evidence-summary layer to use Amazon Nova Pro through Bedrock. The provider is configurable; the deterministic policy, ledger, and safety tests are unchanged.

## Deliberate design decisions

| Decision | Why it matters |
|---|---|
| The model cannot set sale state | A fluent model response cannot clear a hold. |
| No diagnostic or chemical advice | The product prevents a risky workflow failure instead of simulating agronomic expertise. |
| Evidence receipt does not clear the hold | A human reviewer remains accountable for the next step. |
| Raw image data is not written to the local ledger | The demo avoids retaining the uploaded image after inference. |
| A provider outage falls back to the deterministic explanation | The safety gate keeps working if live summarization is unavailable. |

## Runtime disclosure

The build work was performed with Codex using GPT-5.6. The live, deployed evidence-summary integration is Amazon Nova Pro through AWS Bedrock. This was chosen so the project can run without paid OpenAI API quota. Nova Pro only summarizes supplied text and an optional image in a constrained JSON shape; it cannot alter policy state.

## Evidence a reviewer can inspect

- `lib/policy.mjs` — deterministic state authority
- `fixtures/safety-cases.json` and `scripts/evaluate.mjs` — eight policy cases
- `scripts/model-guard-test.mjs` — output guard checks
- `scripts/live-model-smoke.mjs` — one-call live-provider contract check
- `docs/EVALUATION.md` — scoped evaluation claim and limits
