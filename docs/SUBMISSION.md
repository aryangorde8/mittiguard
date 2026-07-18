# Devpost submission copy

## Name

MittiGuard

## Tagline

Don’t sell blind: an Evidence Relay that turns unsupported farm-input sales into owned field-evidence work.

## Track

Work & Productivity

## Description

Agri-input dealers are often the point where a farmer’s crop symptom becomes a pesticide or fertiliser purchase. But yellowing and leaf damage can reflect disease, nutrient stress, water stress, or an unresolved earlier treatment. Most farm apps turn that uncertainty into a confident-looking recommendation.

MittiGuard Relay is a dealer-side evidence-recovery workflow that does the opposite. At the counter, it captures the field, crop stage, farmer language, optional voice-note transcript, symptom, Soil Health Card date, prior input outcome, a field photo, and live weather context. Amazon Nova Pro turns reviewed unstructured evidence into an editable evidence draft and an evidence-only brief across this mixed context. A separate deterministic policy engine then decides whether the sale must be paused or can move to qualified human review.

When evidence conflicts, MittiGuard Relay changes the state of the work: the POS Gate returns **NOT RELEASED** with an auditable decision receipt, the invoice becomes **ON HOLD**, exact evidence tasks are generated, a role is assigned, a 24-hour SLA starts, and a WhatsApp-ready handoff is prepared for the field team. Each step becomes a linked audit event in the persistent field-memory ledger. With its server audit secret configured, the chain is HMAC-sealed and the POS receipt anchors the exact ledger head that produced the no-release decision. A named reviewer can attest only the exact evidence digest and audit head they saw; that attestation is still **NOT RELEASED**, not a chemical approval. If the farmer returns after an unsuccessful input, the ledger makes that history visible before another sale occurs.

The most important safeguard is automatic: the server matches a new case against unresolved, similar field history and creates **Evidence Debt**. Even if a dealer clears the “prior input failed” toggle, a matching field-history record still blocks the sale and routes it for review.

MittiGuard never diagnoses disease or recommends a pesticide, fertiliser, dose, or timing. Its value is calibrated refusal: stopping a blind sale and turning uncertainty into an auditable evidence task.

Farm-input decisions compound across farms, livelihoods, soils, and food systems. MittiGuard Relay does not claim to solve food security; its focused contribution is to prevent one avoidable operational failure—an unsupported repeat input—from being treated as a confident decision.

## Features

- Dealer-facing counter workflow for pesticide and fertiliser requests
- Optional browser voice-note transcript with English, Telugu, Hindi, and Tamil selection
- Constrained AI evidence-intake draft from reviewed voice/text and an optional real field image
- Deterministic evidence gate: only `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`
- Optional Amazon Nova Pro structured evidence brief with real image intake
- Decision Room evidence map that separates model observations from deterministic sale control
- Three-lane Evidence Relay: counter block, field capture, and extension review
- Role-owned evidence tasks, SLA, copyable field handoff, and case audit trace
- Server-side Repeat-Risk Matcher that creates Evidence Debt from unresolved field history
- POS Gate API that returns a no-release invoice receipt, decision digest, and relay handoff
- HMAC-sealed, hash-linked audit ledger with read-only verification proof and POS receipt anchor
- Evidence- and audit-bound Human Review Attestation that can never authorize a sale
- Live weather context from Open-Meteo
- Persistent local field-memory ledger and extension-review queue
- Evidence-received workflow that cannot silently clear a sale hold
- Extension-owned outcome loop that turns a neutral observed outcome into future Field Memory without releasing the current sale
- Dockerfile for a reproducible Node 22 deployment
- Nine transparent safety fixtures plus a live model contract smoke test
- 24-case synthetic adversarial Evidence Debt benchmark with explicit scope and hard negatives
- In-app server replay of 45 deterministic policy, Evidence Debt, gate-to-review, and audit-integrity checks
- Server-side guard that rejects dosage, action advice, and requested-product echoes from the model

## How we used Codex and GPT-5.6

Codex using GPT-5.6 accelerated the end-to-end build: the product architecture, full-stack implementation, deterministic policy engine, safety fixtures, persistent demo ledger, UI, and submission materials.

The deployed evidence-brief path uses Amazon Nova Pro through Bedrock. It receives a real uploaded field image when available plus structured case context, and returns a constrained JSON brief with an image-context field. It is prohibited from diagnosing crops, recommending products, doses, timing, or overriding the policy engine. Consequential state changes are deterministic, auditable, and covered by fixtures.

## Testing

```bash
npm run check
# With AWS_BEARER_TOKEN_BEDROCK configured:
npm run smoke:model
```
