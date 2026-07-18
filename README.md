# MittiGuard Relay

**Don’t sell blind.** MittiGuard Relay is an evidence-recovery workflow for agri-input dealers and extension teams. It turns an ambiguous counter request into field-capture tasks, a human-owned review handoff, and a persistent audit trail before an unsupported pesticide or fertiliser sale is made.

It is a hackathon prototype, not an agronomic diagnostic or recommendation system. It never generates chemical products, doses, or application instructions.

## For judges — the 60-second proof

Use the public demo URL in the Devpost submission, or run the project locally. In the app, click **Run bypass proof**. It uses the real server path: reset the synthetic ledger, clear the dealer's **Prior input did not resolve the issue** claim, and submit the counter case to the POS Gate.

You should see one narrow claim proved in the interface:

`dealer claims no prior failure → server finds Evidence Debt → POS returns NOT RELEASED → exact evidence work is assigned`

Then open **Evidence Relay** to complete the non-authorizing review workflow, **Field memory** to see the future repeat-risk record, and **Safety bench** to run the 45-check server replay. A model, a task completion, and a human attestation all leave the invoice `NOT_RELEASED`.

## What it demonstrates

1. **POS Gate:** every counter route returns `NOT_RELEASED`; the deterministic policy has no approved-sale state.
2. **Evidence Debt:** a server-side Field Memory match catches a repeat even if the dealer clears the prior-failure control in the browser.
3. **Owned recovery work:** the relay creates exact evidence tasks, owner, SLA, and a short-lived mobile Field Capture link instead of a chemical recommendation.
4. **Bound human review:** a named reviewer can attest only the exact evidence digest and HMAC-sealed audit head they saw. That record is still `NOT_RELEASED`.
5. **Inspectable proof:** the Safety Bench replays 45 deterministic policy, Evidence Debt, and gate-to-review controls in the running app.

Amazon Nova Pro can turn reviewed text and an optional image into a constrained evidence draft and evidence-only brief. It cannot change the sale state, recommend an input, or bypass any of the controls above.

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
  -e MITTIGUARD_PUBLIC_BASE_URL=http://localhost:8080 \
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

For the sealed Human Review Attestation, set a stable `MITTIGUARD_AUDIT_SECRET` before creating the demo ledger. If the current ledger predates that secret or the current sealed-audit format, restart and use **Load clean jury demo** once; older entries cannot be retroactively given the current anchor.

## Safety evaluation

```bash
npm test
```

The nine fixtures deliberately test the policy decision, not disease-diagnosis accuracy. Every fixture must end in either `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`; no policy path can approve a sale. The same test command also checks the server-side model-output guard.

It also runs the transparent Evidence Debt benchmark: 24 synthetic adversarial records (12 repeat matches and 12 hard negatives). The current matcher is deliberately scoped to an exact field and crop plus at least two shared symptom signals. A passing synthetic fixture is not an agronomic validation claim.

The running app's **Safety Bench** calls a read-only, server-side replay of 45 deterministic checks: nine policy fixtures, 24 Evidence Debt cases, and 12 gate-to-review/audit-integrity checks. The separately tested POS endpoint contract is covered by `npm test`. This is reproducible product-policy evidence, not a crop-diagnosis benchmark.

For the one-command judge path (temporary ledger, health contract, clean reset, real POS gate, replay, and sealed audit verification), run:

```bash
npm run verify:judge
```

With a live key configured, run the one-call contract check:

```bash
npm run smoke:model
```

It uses a synthetic ambiguous case and checks that Amazon Nova Pro returns the required structured evidence summary without a product name or dosage. It does not evaluate agronomic correctness.

For a transparent, opt-in **24-record predeclared evaluation** of the live Nova **intake-draft** path, run:

```bash
npm run eval:intake:nova
```

It skips cleanly without a Bedrock token and is deliberately outside `npm test` because it makes live requests. It reports extraction and safety-contract metrics only—not agronomic accuracy. For a machine-readable, date-neutral report, run `npm run eval:intake:nova -- --json`; see [the live intake evaluation protocol](docs/LIVE_INTAKE_EVALUATION.md).

## Architecture

```text
Counter request + reviewed field evidence
            |
            +--> deterministic policy + server-side Evidence Debt
            |                 |
            |                 +--> POS receipt: NOT_RELEASED
            |                                |
            |                                +--> owned evidence tasks + field handoff
            |                                             |
            |                                             +--> HMAC-bound human attestation: still NOT_RELEASED
            |                                                          |
            |                                                          +--> neutral field outcome
            |                                                                       |
            +--> Field Memory <-----------------------------------------------+
                     |
                     +--> next counter request: repeat-risk check

Nova Pro: reviewed evidence draft / brief only; never a sale-state authority.
```

## Built with Codex and GPT-5.6

Codex using GPT-5.6 accelerated the full-stack prototype: product architecture, deterministic policy, Evidence Relay state model, test fixtures, UI, provider abstraction, and submission materials. The deployed live evidence brief uses Amazon Nova Pro through Bedrock so the project can be demonstrated without OpenAI API billing. All consequential sale-state changes stay deterministic and auditable. See the [Codex collaboration record](docs/CODEX_COLLABORATION.md) for the specific decisions and inspectable evidence.

## Current limits

- The persistent ledger is a local JSON store for a self-contained demo, not a multi-user database. `MITTIGUARD_AUDIT_SECRET` seals new audit entries with HMAC-SHA256 but is not a substitute for production identity, access control, backups, or a compliance program.
- The public instance defaults to `jury-demo` mode, which deliberately accepts synthetic write interactions so judges can run the story. `operations` mode requires a server-held operator key for every write, but a real deployment would still need user identity, role management, and a durable data service.
- Weather comes from Open-Meteo and is presented as context, never as action advice.
- A real photo uploaded in a synthetic case is included in the optional Nova Pro evidence request. The default demo deliberately starts with **no** field image; it creates a Field Capture task that requires an actual image receipt before completion. A production build would add consent, retention, and local evidence-validation controls.
- Voice intake uses browser speech recognition when available and stores only the reviewed transcript, never audio. The handoff is copyable text, not a messaging integration.
- Mobile Field Capture is a one-time, hash-and-receipt-only handoff. It stores a bounded neutral observation plus image format, size, and SHA-256 digest—not raw image bytes or a viewable evidence archive. A production rollout would add consent, authenticated reviewer access, retention/deletion controls, and durable evidence storage.
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
