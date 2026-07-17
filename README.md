# MittiGuard

**Don’t sell blind.** MittiGuard is an evidence gate for agri-input dealers and extension teams. It turns an ambiguous counter request into a field-linked review case before an unsupported pesticide or fertiliser sale is made.

It is a hackathon prototype, not an agronomic diagnostic or recommendation system. It never generates chemical products, doses, or application instructions.

## What it demonstrates

1. A dealer captures crop, symptom, Soil Health Card age, prior input history, and a field photo.
2. A deterministic policy engine pauses a sale when evidence is incomplete or conflicts.
3. An optional Amazon Nova Pro / Bedrock call writes an evidence-only summary in a strict JSON shape. It cannot alter the sale state.
4. The app creates a persistent extension-review case and a field-ledger event; recording evidence received still does not clear the sale hold.
5. Included fixtures prove the safety policy for ambiguous, missing-evidence, repeat-failure, complete-evidence, and instruction-injection cases.
6. A server-side model-output guard rejects dosage, action-advice, and requested-product echoes before a model summary can be displayed.

## Run locally

Requires Node.js 20 or newer.

```bash
npm run dev
```

Then open <http://localhost:3000>.

The prototype works without credentials using its deterministic demo assessment. For the live Amazon Nova Pro evidence-summary path, copy the example configuration and add your Bedrock API key before starting the server:

```bash
cp .env.example .env
# Edit .env and set AWS_BEARER_TOKEN_BEDROCK. Do not commit this file.
npm run dev
```

`AWS_BEARER_TOKEN_BEDROCK` is only read on the server and is never sent to the browser. `AWS_REGION` defaults to `us-east-1`; set it to the Bedrock region where Nova Pro is enabled for your account. The application uses Node's `--env-file-if-exists` option, so the same setup works with `npm run start`.

## Safety evaluation

```bash
npm test
```

The eight fixtures deliberately test the policy decision, not disease-diagnosis accuracy. Every fixture must end in either `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`; no policy path can approve a sale. The same test command also checks the server-side model-output guard.

With a live key configured, run the one-call contract check:

```bash
npm run smoke:model
```

It uses a synthetic ambiguous case and checks that Amazon Nova Pro returns the required structured evidence summary without a product name or dosage. It does not evaluate agronomic correctness.

## Architecture

```text
Counter case + field evidence
            |
            +--> deterministic policy (`lib/policy.mjs`) --> sale state
            |                                                   |
            |                                                   +--> persistent case + field ledger (`data/store.json`)
            |
            +--> optional Nova Pro evidence summary --> explanation only
```

## Built with Codex and GPT-5.6

Codex using GPT-5.6 accelerated the full-stack prototype: product architecture, the deterministic policy, test fixtures, UI, provider abstraction, and submission materials. The deployed live evidence summary uses Amazon Nova Pro through Bedrock so the project can be demonstrated without OpenAI API billing. All consequential sale-state changes stay deterministic and auditable. See the [Codex collaboration record](docs/CODEX_COLLABORATION.md) for the specific decisions and inspectable evidence.

## Current limits

- The persistent ledger is a local JSON store for a self-contained demo, not a multi-user database.
- Weather comes from Open-Meteo and is presented as context, never as action advice.
- A real photo uploaded in a live case is included in the optional Nova Pro evidence request. The default demo case uses a clearly labelled simulated attachment; a production build would add consent, retention, and local evidence-validation controls.
- MittiGuard is not a disease classifier, pesticide recommender, or compliance certification system.

## Hackathon materials

- [Demo run-of-show](docs/DEMO.md)
- [Evaluation protocol](docs/EVALUATION.md)
- [Ready-to-paste submission copy](docs/SUBMISSION.md)
- [Codex collaboration record](docs/CODEX_COLLABORATION.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)
