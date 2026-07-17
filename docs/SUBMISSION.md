# Devpost submission copy

## Name

MittiGuard

## Tagline

Don’t sell blind: an Evidence Relay that turns unsupported farm-input sales into owned field-evidence work.

## Track

Work & Productivity

## Description

Agri-input dealers are often the point where a farmer’s crop symptom becomes a pesticide or fertiliser purchase. But yellowing and leaf damage can reflect disease, nutrient stress, water stress, or an unresolved earlier treatment. Most farm apps turn that uncertainty into a confident-looking recommendation.

MittiGuard Relay is a dealer-side evidence-recovery workflow that does the opposite. At the counter, it captures the field, crop stage, farmer language, optional voice-note transcript, symptom, Soil Health Card date, prior input outcome, a field photo, and live weather context. Amazon Nova Pro creates an evidence-only brief across this mixed context. A separate deterministic policy engine then decides whether the sale must be paused or can move to qualified human review.

When evidence conflicts, MittiGuard Relay changes the state of the work: the invoice becomes **ON HOLD**, exact evidence tasks are generated, a role is assigned, a 24-hour SLA starts, and a WhatsApp-ready handoff is prepared for the field team. Each step becomes an audit event in the persistent field-memory ledger. If the farmer returns after an unsuccessful input, the ledger makes that history visible before another sale occurs. Even after evidence is received, the hold remains until a qualified reviewer owns the next step.

MittiGuard never diagnoses disease or recommends a pesticide, fertiliser, dose, or timing. Its value is calibrated refusal: stopping a blind sale and turning uncertainty into an auditable evidence task.

## Features

- Dealer-facing counter workflow for pesticide and fertiliser requests
- Optional browser voice-note transcript with English, Telugu, Hindi, and Tamil selection
- Deterministic evidence gate: only `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`
- Optional Amazon Nova Pro structured evidence brief with real image intake
- Three-lane Evidence Relay: counter block, field capture, and extension review
- Role-owned evidence tasks, SLA, copyable field handoff, and case audit trace
- Live weather context from Open-Meteo
- Persistent local field-memory ledger and extension-review queue
- Evidence-received workflow that cannot silently clear a sale hold
- Eight transparent safety fixtures plus a live model contract smoke test
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
