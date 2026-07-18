# Live Nova intake evaluation

This optional harness checks the **live Amazon Nova Pro evidence-intake path** against a predeclared suite of 24 transparent, synthetic records. It is intentionally separate from `npm test` because a complete run makes up to 24 Bedrock requests.

It evaluates only whether the live model returns a constrained, editable evidence draft that preserves specified reviewed text and names explicit evidence gaps. It does **not** measure crop-disease recognition, treatment quality, yield, visual/image understanding, field performance, or agronomic correctness.

## Run it

Configure the Bedrock token in `.env` (or export it), then run:

```bash
npm run eval:intake:nova
```

The script forces `MODEL_PROVIDER=nova` and imports `getLiveIntakeDraft()` directly. It deliberately does not call the HTTP `/api/intake/extract` endpoint, so its result cannot be a deterministic route fallback.

For a machine-readable, date-neutral report (no timestamp is emitted), run:

```bash
npm run eval:intake:nova -- --json
```

Without `AWS_BEARER_TOKEN_BEDROCK`, the normal command prints `SKIP` and exits successfully without making a network request. Use this strict variant when a live run is required:

```bash
npm run eval:intake:nova:required
```

The `:required` command exits with code `2` when the token is absent. After calls complete, it exits nonzero unless every fixture reached a contract-safe outcome, there were no provider/parse failures, and there were no unexpected output-guard rejections. This distinguishes an unconfigured or degraded live path from a passing run. The fixture manifest is also validated before any API call: it must contain exactly its declared 24 unique records, be within the 20–25-record protocol range, and cover every declared test tag.

## Fixture scope

The public fixture manifest is [`fixtures/live-intake-fixtures.json`](../fixtures/live-intake-fixtures.json). Version 2.0 predeclares 24 fictional records across these categories:

1. complete and intentionally sparse written context;
2. isolated missing-evidence cases for field identity, crop stage, image, Soil Health Card, and prior-input history;
3. reviewed English, Hindi transliterated, Hindi, Telugu, Spanish, and Portuguese text;
4. transcript-only evidence, including multilingual transcripts;
5. synthetic image-attached cases and image-present cases with other evidence still missing;
6. a dated soil record that is present even if downstream policy separately evaluates freshness;
7. prompt/instruction-injection text; and
8. requested-product and dosage echoes embedded in narrative or transcript text.

Each image-attached record references the same in-manifest one-pixel PNG. It verifies only that the live request receives an attachment and that the draft does not falsely claim a missing image. It is **not** a photo-quality, image-understanding, or crop-vision test.

## Reported measures

The runner prints raw counts and percentages for:

- structured Amazon Nova Pro drafts;
- direct-draft full-fixture passes against the explicit extraction expectations;
- contract-safe fixture passes, which additionally count an expected server-side guard rejection for a deliberately hostile prompt;
- exact crop and crop-stage agreement;
- symptom-anchor recall;
- required evidence-gap recall;
- explicit false-gap rate, measured only against context that the fixture visibly supplies;
- requested-product-safe drafts and server-side model-output-guard rejections;
- provider/parse failures; and
- median successful-call latency.

The `--json` report contains the suite version, fixed fixture count, provider/model configuration, aggregate measures, and a per-fixture status. It deliberately does not emit timestamps or raw draft content.

These are reproducible **product-contract metrics**, not claims about real crops. A lower score should prompt inspection of the visible fixture and model draft, not a conclusion about agronomic performance.

## Safety boundary

Each live result passes through MittiGuard's existing server-side evidence-only guard before the harness receives it. A draft that repeats a requested product or contains disallowed advice is recorded as `PROTECTED` when the guard rejects it; it is never displayed or treated as a structured draft.

For fixtures explicitly marked `allowGuardRejection`, either outcome is a valid safety path:

- Nova returns a clean, complete evidence draft that satisfies the fixture; or
- the server guard rejects a draft that crossed the evidence-only boundary.

This is why the report distinguishes a direct-draft pass from a contract-safe pass. The evaluation does not grant a sale, change the deterministic gate, alter field memory, or write to the ledger.

The actual sale invariant is evaluated separately by the deterministic policy, POS contract tests, audit-chain tests, and Evidence Relay replay. See [the broader evaluation protocol](EVALUATION.md).
