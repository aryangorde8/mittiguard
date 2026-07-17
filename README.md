# MittiGuard Relay

**Don’t sell blind.** MittiGuard Relay is an evidence-recovery workflow for agri-input dealers and extension teams. It turns an ambiguous counter request into field-capture tasks, a human-owned review handoff, and a persistent audit trail before an unsupported pesticide or fertiliser sale is made.

It is a hackathon prototype, not an agronomic diagnostic or recommendation system. It never generates chemical products, doses, or application instructions.

## What it demonstrates

1. A dealer captures the crop, symptom, field history, Soil Health Card age, optional browser voice-note transcript, and a live field photo. Nova can turn the reviewed narrative and image into an editable evidence draft; it cannot authorize a sale.
2. A deterministic policy engine pauses a sale when evidence is incomplete or conflicts.
3. Amazon Nova Pro can create a constrained, multimodal evidence brief and image-context note. It cannot alter the sale state.
4. The Evidence Relay creates exact evidence tasks, assigns a role, sets a 24-hour SLA, produces a copyable field handoff, and writes an audit trail.
5. The server-side Repeat-Risk Matcher turns unresolved, similar field outcomes into **Evidence Debt**, even when the dealer does not report a failed prior input.
6. The **Decision Room** makes the evidence path legible: voice/story, image, soil, weather, and field memory converge on a visibly separate deterministic sale gate.
7. Recording each evidence task moves only the relay phase; even a completed evidence packet remains `ON_HOLD` until qualified human review.
8. Included fixtures prove the safety policy for ambiguous, missing-evidence, automatic-repeat-risk, complete-evidence, instruction-injection, and relay-state cases.
9. A server-side model-output guard rejects dosage, action-advice, and requested-product echoes before a model summary can be displayed.
10. The POS-facing `POST /api/pos/authorize-sale` contract returns a no-release receipt, decision digest, evidence-case ID, and handoff code for a billing system.
11. A qualified reviewer can record a neutral observed field outcome; it becomes future field memory, but never releases the current sale.

## Run locally

Requires Node.js 20 or newer.

```bash
npm run dev
```

Then open <http://localhost:3000>.

## Run as a container

The repository includes a deployment-ready Node 22 container. It deliberately excludes `.env` and the local demo ledger from the image.

```bash
docker build -t mittiguard .
docker run --rm -p 8080:8080 \
  -e MODEL_PROVIDER=nova \
  -e AWS_REGION=us-east-1 \
  -e NOVA_MODEL_ID=amazon.nova-pro-v1:0 \
  -e AWS_BEARER_TOKEN_BEDROCK='your-token-here' \
  mittiguard
```

Open <http://localhost:8080>. Mount a persistent volume and set `MITTIGUARD_STORE_PATH` before using this beyond a demo; the bundled ledger is intentionally local and not multi-user storage.

For a repeatable recording, use **Load clean jury demo** in the app. It asks for confirmation, clears only the local JSON demo ledger, and restores one curated field history. Do not use it for real customer data.

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

The nine fixtures deliberately test the policy decision, not disease-diagnosis accuracy. Every fixture must end in either `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`; no policy path can approve a sale. The same test command also checks the server-side model-output guard.

It also runs the transparent Evidence Debt benchmark: 24 synthetic adversarial records (12 repeat matches and 12 hard negatives). The current matcher is deliberately scoped to an exact field and crop plus at least two shared symptom signals. A passing synthetic fixture is not an agronomic validation claim.

With a live key configured, run the one-call contract check:

```bash
npm run smoke:model
```

It uses a synthetic ambiguous case and checks that Amazon Nova Pro returns the required structured evidence summary without a product name or dosage. It does not evaluate agronomic correctness.

## Architecture

```text
Counter story + voice transcript + field evidence
            |
            +--> Nova Pro evidence brief --> explanation and image context only
            |
            +--> field-memory repeat-risk matcher --> Evidence Debt
            |                                           |
            +--> deterministic policy (`lib/policy.mjs`) --> invoice state
            |                                                   |
            |                                                   +--> POS Gate receipt + Evidence Relay tasks + owner + SLA + audit trail
            |                                                                 |
            |                                                                 +--> persistent case + field ledger (`data/store.json`)
```

## Built with Codex and GPT-5.6

Codex using GPT-5.6 accelerated the full-stack prototype: product architecture, deterministic policy, Evidence Relay state model, test fixtures, UI, provider abstraction, and submission materials. The deployed live evidence brief uses Amazon Nova Pro through Bedrock so the project can be demonstrated without OpenAI API billing. All consequential sale-state changes stay deterministic and auditable. See the [Codex collaboration record](docs/CODEX_COLLABORATION.md) for the specific decisions and inspectable evidence.

## Current limits

- The persistent ledger is a local JSON store for a self-contained demo, not a multi-user database.
- Weather comes from Open-Meteo and is presented as context, never as action advice.
- A real photo uploaded in a live case is included in the optional Nova Pro evidence request. The default demo case uses a clearly labelled simulated attachment; a production build would add consent, retention, and local evidence-validation controls.
- Voice intake uses browser speech recognition when available and stores only the reviewed transcript, never audio. The WhatsApp-ready handoff is copyable text, not a messaging integration.
- MittiGuard is not a disease classifier, pesticide recommender, or compliance certification system.

## Hackathon materials

- [Demo run-of-show](docs/DEMO.md)
- [Evaluation protocol](docs/EVALUATION.md)
- [Ready-to-paste submission copy](docs/SUBMISSION.md)
- [Codex collaboration record](docs/CODEX_COLLABORATION.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)
