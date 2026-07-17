# MittiGuard evaluation protocol

## The claim being evaluated

MittiGuard does **not** claim to diagnose a crop disease, determine a fertiliser plan, or improve yield. Its scoped claim is:

> When required context is missing or conflicts, the software never turns the case into an automatically approved input sale.

## What the automated fixtures cover

`npm test` runs nine deterministic policy fixtures:

| Fixture | Expected state |
|---|---|
| Yellowing symptom + stale soil report + failed prior input | ON_HOLD |
| Fertiliser request without soil report | ON_HOLD |
| Pesticide request without a photo | ON_HOLD |
| Complete pesticide evidence package | REQUIRES_HUMAN_REVIEW |
| Missing crop stage | ON_HOLD |
| Unlinked field | ON_HOLD |
| Complete fertiliser evidence package | REQUIRES_HUMAN_REVIEW |
| Instruction-like text attempting to bypass policy | REQUIRES_HUMAN_REVIEW |
| Automatic field-memory match with dealer failure toggle off | ON_HOLD |

The runner also asserts that a fixture can reach only `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`; it has no approved-sale outcome. The automatic-repeat-risk fixture proves that a browser-side checkbox cannot bypass a server-derived field-history match.

## Evidence Debt benchmark

`scripts/evidence-debt-benchmark.mjs` runs 24 transparent synthetic adversarial cases against a clean field ledger: 12 repeat cases and 12 hard negatives. On this scoped fixture it reports precision, recall, and specificity. The current matcher deliberately requires:

1. the exact same field;
2. the exact same crop; and
3. at least two shared symptom signals, after a small documented alias normalization (`rainfall` → `rain`, `yellow` → `yellowing`).

The hard negatives include the same symptom on another field, the same symptom on another crop, and same-field cases with only one shared signal. The result is a regression benchmark for product behavior, **not** a claim of field-level disease accuracy or a substitute for agronomic validation.

## POS Gate contract check

`scripts/pos-contract-test.mjs` asserts that the POS receipt has a stable contract, invoice ID, decision digest, handoff code, and `saleAuthorization: NOT_RELEASED`. `scripts/pos-endpoint-test.mjs` starts an isolated local server and verifies the same behavior over HTTP, including persistence of the invoice ID and `POS_GATE_API` channel. The counter UI uses this API contract at `/api/pos/authorize-sale`; see [POS_GATE.md](POS_GATE.md).

## Persistence check

The test suite uses an isolated temporary local ledger and verifies that:

1. a case is stored;
2. a field-memory event is added;
3. an “evidence received” update does not clear the hold; and
4. raw image data is not persisted.

## Evidence Relay state check

The isolated store test also verifies that a new case receives role-owned evidence tasks, an SLA, a copyable handoff, and an audit event. Recording a task may move the case from field capture to extension review, but it must leave `saleState` as `ON_HOLD`. This prevents “evidence received” from becoming a hidden approval path.

## Live-model contract check

`npm run smoke:model` is intentionally separate because it makes one API call. It supplies a synthetic ambiguous case and asserts that the response has the required structured evidence-summary shape and contains neither a named product nor a dosage. The default configured provider is Amazon Nova Pro through Bedrock.

Before any model summary or intake draft reaches the browser, MittiGuard rejects a response that contains a dosage, action-oriented chemical advice, or a repeat of the requested product. The route then retains the deterministic assessment and gate state. `npm test` includes direct checks for both guards.

This is a contract check, not a benchmark of agronomic truth. Before any real deployment, an independent local agronomist, field-test protocol, jurisdiction-specific review, and privacy program would all be required.
