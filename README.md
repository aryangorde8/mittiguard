# MittiGuard Relay

**Don’t sell blind.** MittiGuard Relay is an evidence-recovery workflow for agri-input dealers and extension teams. It turns an ambiguous counter request into field-capture tasks, a human-owned review handoff, and a persistent audit trail before an unsupported pesticide or fertiliser sale is made.

It is a hackathon prototype, not an agronomic diagnostic or recommendation system. It never generates chemical products, doses, or application instructions.

## What it demonstrates

1. A dealer captures the crop, symptom, field history, Soil Health Card age, optional browser voice-note transcript, and a live field photo. Nova can turn the reviewed narrative and image into an editable evidence draft; it cannot authorize a sale.
2. A deterministic policy engine pauses a sale when evidence is incomplete or conflicts.
3. Amazon Nova Pro can create a constrained, multimodal evidence brief and image-context note. It cannot alter the sale state.
4. The Evidence Relay creates exact evidence tasks, assigns a role, sets a 24-hour SLA, produces a copyable field handoff, and writes an audit trail.
5. The server-side Repeat-Risk Matcher turns unresolved, similar field history into **Evidence Debt**, even when the dealer does not report a failed prior input.
6. The **Decision Room** makes the evidence path legible: voice/story, image, soil, weather, and field memory converge on a visibly separate deterministic sale gate.
7. Recording each evidence task moves only the relay phase; even a completed evidence packet remains `ON_HOLD` until qualified human review.
8. Included fixtures prove the safety policy for ambiguous, missing-evidence, automatic-repeat-risk, complete-evidence, instruction-injection, and relay-state cases.
9. A server-side model-output guard rejects dosage, action-advice, and requested-product echoes before a model summary can be displayed.
10. The POS-facing `POST /api/pos/authorize-sale` contract returns a no-release receipt, decision digest, evidence-case ID, and handoff code for a billing system.
11. A named reviewer can attest the exact POS-bound evidence digest and audit head; it remains `NOT_RELEASED` and is never a sale approval.
12. A qualified reviewer can record a neutral observed field outcome only after a valid attestation; it becomes future field memory, but never releases the current sale.
13. Every relay event is linked into a server audit chain. With `MITTIGUARD_AUDIT_SECRET` configured, the chain is HMAC-SHA256 sealed, verified through a read-only endpoint, and anchored in the POS receipt.
14. The Safety Bench can replay 45 deterministic checks in the running app: nine policy fixtures, 24 Evidence Debt adversarial cases, and 12 gate-to-review integrity checks.

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
mkdir -p ./mittiguard-runtime
docker run --rm -p 8080:8080 \
  -v "$PWD/mittiguard-runtime:/var/lib/mittiguard" \
  -e PORT=8080 \
  -e MITTIGUARD_STORE_PATH=/var/lib/mittiguard/store.json \
  -e MITTIGUARD_MODE=jury-demo \
  -e MODEL_PROVIDER=nova \
  -e AWS_REGION=us-east-1 \
  -e NOVA_MODEL_ID=amazon.nova-pro-v1:0 \
  -e AWS_BEARER_TOKEN_BEDROCK='your-token-here' \
  -e MITTIGUARD_AUDIT_SECRET='long-random-secret-here' \
  mittiguard
```

Open <http://localhost:8080>. The runtime ledger is deliberately outside the image and Git checkout; `data/demo-store.json` remains a read-only reset fixture. For a deployment beyond this jury demo, use a dedicated persistent volume and set `MITTIGUARD_STORE_PATH`; see [deployment notes](docs/DEPLOY.md).

For a repeatable recording, use **Load clean jury demo** in the app. It asks for confirmation, clears only the local JSON demo ledger, and restores one curated field history. Do not use it for real customer data.

The prototype works without credentials using its deterministic demo assessment. For the live Amazon Nova Pro evidence-summary path, copy the example configuration and add your Bedrock API key before starting the server:

```bash
cp .env.example .env
# Edit .env and set AWS_BEARER_TOKEN_BEDROCK. Do not commit this file.
npm run dev
```

`AWS_BEARER_TOKEN_BEDROCK` is only read on the server and is never sent to the browser. `AWS_REGION` defaults to `us-east-1`; set it to the Bedrock region where Nova Pro is enabled for your account. The application uses Node's `--env-file-if-exists` option, so the same setup works with `npm run start`.

For the sealed Human Review Attestation, set a stable `MITTIGUARD_AUDIT_SECRET` before creating the demo ledger. If the current ledger predates that secret, restart and use **Load clean jury demo** once; older SHA-only entries cannot be retroactively sealed.

## Safety evaluation

```bash
npm test
```

The nine fixtures deliberately test the policy decision, not disease-diagnosis accuracy. Every fixture must end in either `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`; no policy path can approve a sale. The same test command also checks the server-side model-output guard.

It also runs the transparent Evidence Debt benchmark: 24 synthetic adversarial records (12 repeat matches and 12 hard negatives). The current matcher is deliberately scoped to an exact field and crop plus at least two shared symptom signals. A passing synthetic fixture is not an agronomic validation claim.

The running app's **Safety Bench** calls a read-only, server-side replay of 45 deterministic checks: nine policy fixtures, 24 Evidence Debt cases, and 12 gate-to-review/audit-integrity checks. The separately tested POS endpoint contract is covered by `npm test`. This is reproducible product-policy evidence, not a crop-diagnosis benchmark.

With a live key configured, run the one-call contract check:

```bash
npm run smoke:model
```

It uses a synthetic ambiguous case and checks that Amazon Nova Pro returns the required structured evidence summary without a product name or dosage. It does not evaluate agronomic correctness.

For a transparent, opt-in seven-record evaluation of the live Nova **intake-draft** path, run:

```bash
npm run eval:intake:nova
```

It skips cleanly without a Bedrock token and is deliberately outside `npm test` because it makes live requests. It reports evidence-extraction and safety-contract metrics only; see [the live intake evaluation protocol](docs/LIVE_INTAKE_EVALUATION.md).

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
            |                                                   +--> POS Gate no-release receipt + audit anchor
            |                                                   |
            |                                                   +--> Evidence Relay tasks + owner + SLA + HMAC audit chain
            |                                                                 |
            |                                                                 +--> persistent case + field ledger (`MITTIGUARD_STORE_PATH`)
```

## Built with Codex and GPT-5.6

Codex using GPT-5.6 accelerated the full-stack prototype: product architecture, deterministic policy, Evidence Relay state model, test fixtures, UI, provider abstraction, and submission materials. The deployed live evidence brief uses Amazon Nova Pro through Bedrock so the project can be demonstrated without OpenAI API billing. All consequential sale-state changes stay deterministic and auditable. See the [Codex collaboration record](docs/CODEX_COLLABORATION.md) for the specific decisions and inspectable evidence.

## Current limits

- The persistent ledger is a local JSON store for a self-contained demo, not a multi-user database. `MITTIGUARD_AUDIT_SECRET` seals new audit entries with HMAC-SHA256 but is not a substitute for production identity, access control, backups, or a compliance program.
- The public instance defaults to `jury-demo` mode, which deliberately accepts synthetic write interactions so judges can run the story. `operations` mode requires a server-held operator key for every write, but a real deployment would still need user identity, role management, and a durable data service.
- Weather comes from Open-Meteo and is presented as context, never as action advice.
- A real photo uploaded in a live case is included in the optional Nova Pro evidence request. The default demo case uses a clearly labelled simulated attachment; a production build would add consent, retention, and local evidence-validation controls.
- Voice intake uses browser speech recognition when available and stores only the reviewed transcript, never audio. The WhatsApp-ready handoff is copyable text, not a messaging integration.
- MittiGuard is not a disease classifier, pesticide recommender, or compliance certification system.

## Hackathon materials

- [Demo run-of-show](docs/DEMO.md)
- [Evaluation protocol](docs/EVALUATION.md)
- [Live Nova intake evaluation](docs/LIVE_INTAKE_EVALUATION.md)
- [Human review attestation protocol](docs/REVIEW_ATTESTATION.md)
- [Ready-to-paste submission copy](docs/SUBMISSION.md)
- [Codex collaboration record](docs/CODEX_COLLABORATION.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)
- [Deployment notes](docs/DEPLOY.md)
