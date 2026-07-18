# Live Nova intake evaluation

This optional harness checks the **live Amazon Nova Pro evidence-intake path** on seven transparent, synthetic records. It is intentionally separate from `npm test` because it can make seven Bedrock requests.

It evaluates only whether the live model returns a constrained, editable evidence draft that preserves specified written context and names explicit evidence gaps. It does **not** measure crop-disease recognition, treatment quality, yield, visual/image understanding, field performance, or agronomic correctness.

## Run it

Configure the Bedrock token in `.env` (or export it), then run:

```bash
npm run eval:intake:nova
```

The script forces `MODEL_PROVIDER=nova` and imports `getLiveIntakeDraft()` directly. It deliberately does not call the HTTP `/api/intake/extract` endpoint, so its result cannot be a deterministic route fallback.

Without `AWS_BEARER_TOKEN_BEDROCK`, the normal command prints `SKIP` and exits successfully without making a network request. Use this for CI or when credentials are intentionally absent:

```bash
npm run eval:intake:nova:required
```

The `:required` command exits with code `2` when the token is absent, which distinguishes an unconfigured live check from a completed run.

## Fixture scope

The public fixture file is [`fixtures/live-intake-fixtures.json`](../fixtures/live-intake-fixtures.json). It covers:

1. complete written field context with missing image/soil artifacts;
2. an intentionally sparse record;
3. Hindi-transliterated intake text;
4. instruction-like text containing a requested product;
5. recognition that a supplied attachment exists (not visual diagnosis);
6. symptom extraction from a reviewed voice transcript; and
7. a dated soil record that is present, even if downstream policy separately evaluates its freshness.

All records are fictional. The single attachment is a synthetic one-pixel PNG; it only verifies that the live request receives an attachment flag and is **not** a photo-quality or crop-vision test.

## Reported measures

The runner prints raw counts and percentages for:

- structured Amazon Nova Pro drafts;
- full-fixture passes against the explicit fixture expectations;
- exact crop and crop-stage agreement;
- symptom-anchor recall;
- required evidence-gap recall;
- explicit false-gap rate, measured only against context that the fixture visibly supplies;
- requested-product-safe drafts and server-side model-output-guard rejections;
- provider/parse failures; and
- median successful-call latency.

These are reproducible **product-contract metrics**, not claims about real crops. A lower score should prompt inspection of the visible fixture and model draft, not a conclusion about agronomic performance.

## Safety boundary

Each live result passes through MittiGuard's existing server-side evidence-only guard before the harness receives it. A draft that repeats a requested product or contains disallowed advice is recorded as `PROTECTED` when the guard rejects it; it is never treated as a successful draft. The evaluation does not grant a sale, change the deterministic gate, alter field memory, or write to the ledger.

The actual sale invariant is evaluated separately by the deterministic policy, POS contract tests, audit-chain tests, and Evidence Relay replay. See [the broader evaluation protocol](EVALUATION.md).
