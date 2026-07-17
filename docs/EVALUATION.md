# MittiGuard evaluation protocol

## The claim being evaluated

MittiGuard does **not** claim to diagnose a crop disease, determine a fertiliser plan, or improve yield. Its scoped claim is:

> When required context is missing or conflicts, the software never turns the case into an automatically approved input sale.

## What the automated fixtures cover

`npm test` runs eight deterministic policy fixtures:

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

The runner also asserts that a fixture can reach only `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`; it has no approved-sale outcome.

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

Before any model summary reaches the browser, MittiGuard also rejects a response that contains a dosage, action-oriented chemical advice, or a repeat of the requested product. The route then retains the deterministic assessment and gate state. `npm test` includes direct checks for this guard.

This is a contract check, not a benchmark of agronomic truth. Before any real deployment, an independent local agronomist, field-test protocol, jurisdiction-specific review, and privacy program would all be required.
