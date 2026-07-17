# Devpost submission copy

## Name

MittiGuard

## Tagline

Don’t sell blind: an evidence gate that pauses unsupported farm-input sales before they become repeat mistakes.

## Track

Work & Productivity

## Description

Agri-input dealers are often the point where a farmer’s crop symptom becomes a pesticide or fertiliser purchase. But yellowing and leaf damage can reflect disease, nutrient stress, water stress, or an unresolved earlier treatment. Most farm apps turn that uncertainty into a confident-looking recommendation.

MittiGuard is a dealer-side evidence workflow that does the opposite. At the counter, it captures the field, crop stage, symptom, Soil Health Card date, prior input outcome, a field photo, and live weather context. Amazon Nova Pro creates an evidence-only summary across this mixed context. A separate deterministic policy engine then decides whether the sale must be paused or can move to qualified human review.

When evidence conflicts, MittiGuard changes the state of the work: the cart becomes **ON HOLD**, an extension-review case is created, and the result is written to a persistent field-memory ledger. If the farmer returns after an unsuccessful input, the ledger makes that history visible before another sale occurs. Even after evidence is received, the hold remains until a qualified reviewer owns the next step.

MittiGuard never diagnoses disease or recommends a pesticide, fertiliser, dose, or timing. Its value is calibrated refusal: stopping a blind sale and turning uncertainty into an auditable evidence task.

## Features

- Dealer-facing counter workflow for pesticide and fertiliser requests
- Deterministic evidence gate: only `ON_HOLD` or `REQUIRES_HUMAN_REVIEW`
- Optional Amazon Nova Pro structured evidence summary with real image intake
- Live weather context from Open-Meteo
- Persistent local field-memory ledger and extension-review queue
- Evidence-received workflow that cannot silently clear a sale hold
- Eight transparent safety fixtures plus a live model contract smoke test
- Server-side guard that rejects dosage, action advice, and requested-product echoes from the model

## How we used Codex and GPT-5.6

Codex using GPT-5.6 accelerated the end-to-end build: the product architecture, full-stack implementation, deterministic policy engine, safety fixtures, persistent demo ledger, UI, and submission materials.

The deployed evidence-summary path uses Amazon Nova Pro through Bedrock. It receives a real uploaded field image when available plus structured case context, and returns a constrained JSON evidence summary. It is prohibited from diagnosing crops, recommending products, doses, timing, or overriding the policy engine. Consequential state changes are deterministic, auditable, and covered by fixtures.

## Testing

```bash
npm run check
# With AWS_BEARER_TOKEN_BEDROCK configured:
npm run smoke:model
```
