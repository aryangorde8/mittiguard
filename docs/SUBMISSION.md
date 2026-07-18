# Devpost submission copy

## Name

MittiGuard

## Tagline

Don’t sell blind: an Evidence Relay that turns unsupported farm-input sales into owned field-evidence work.

## Track

Work & Productivity

## Description

At an agri-input counter, the danger is not just a wrong diagnosis—it is incomplete evidence becoming a purchase. Yellowing and leaf damage can reflect disease, nutrient stress, water stress, or an unresolved earlier treatment. MittiGuard Relay makes that ambiguity operationally visible: it blocks unsupported sales, turns uncertainty into owned evidence work, and remembers unresolved outcomes before the next repeat sale.

MittiGuard Relay is a dealer-side evidence-recovery workflow that does the opposite. At the counter, it captures the field, crop stage, farmer language, optional voice-note transcript, symptom, Soil Health Card date, prior input outcome, a field photo, and live weather context. Amazon Nova Pro turns reviewed unstructured evidence into an editable evidence draft and an evidence-only brief across this mixed context. A separate deterministic policy engine then decides whether the sale must be paused or can move to qualified human review.

When evidence conflicts, MittiGuard Relay changes the state of the work: the POS Gate returns **NOT RELEASED** with an auditable decision receipt, the invoice becomes **ON HOLD**, exact evidence tasks are generated, a role is assigned, a 24-hour SLA starts, and a reviewable handoff is prepared for the field team. A Field Capture task can create a one-time mobile link so the worker can submit a bounded observation and image receipt from a phone; MittiGuard stores the hash and metadata, never the raw image bytes. Each step becomes a linked audit event in the persistent field-memory ledger. With its server audit secret configured, the chain is HMAC-sealed and the POS receipt anchors the exact ledger head that produced the no-release decision. A named reviewer can attest only the exact evidence digest and audit head they saw; that attestation is still **NOT RELEASED**, not a chemical approval. If the farmer returns after an unsuccessful input, the ledger makes that history visible before another sale occurs.

The most important safeguard is automatic: the server matches a new case against unresolved, similar field history and creates **Evidence Debt**. Even if a dealer clears the “prior input failed” toggle, a matching field-history record still blocks the sale and routes it for review.

MittiGuard never diagnoses disease or recommends a pesticide, fertiliser, dose, or timing. Its value is calibrated refusal: stopping a blind sale and turning uncertainty into an auditable evidence task.

Farm-input decisions compound across farms, livelihoods, soils, and food systems. MittiGuard Relay does not claim to solve food security; its focused contribution is to prevent one avoidable operational failure—an unsupported repeat input—from being treated as a confident decision.

## Features

- **POS Gate always returns `NOT_RELEASED`.** The policy engine can pause a sale or route it to qualified review, but has no approved-sale state.
- **Evidence Debt defeats a dealer bypass.** A server-side unresolved field-history match still blocks the invoice even if the browser says the prior input did not fail.
- **Exact recovery work is owned.** A case becomes role-owned evidence tasks, a field handoff, an SLA, and a reviewable audit trace—not a chemical recommendation.
- **Human review is bound, not magical.** The reviewer attests the exact POS-bound evidence digest and HMAC-sealed audit head; the attestation stays `NOT_RELEASED`.
- **The control is reproducible.** The running Safety Bench replays 45 deterministic policy, Evidence Debt, and gate-to-review checks.

## How we used Codex and GPT-5.6

Codex using GPT-5.6 accelerated the end-to-end build: the product architecture, full-stack implementation, deterministic policy engine, safety fixtures, persistent demo ledger, UI, and submission materials.

The deployed evidence-brief path uses Amazon Nova Pro through Bedrock. It receives a real uploaded field image when available plus structured case context, and returns a constrained JSON brief with an image-context field. It is prohibited from diagnosing crops, recommending products, doses, timing, or overriding the policy engine. Consequential state changes are deterministic, auditable, and covered by fixtures.

## Testing

```bash
npm run check
# With AWS_BEARER_TOKEN_BEDROCK configured:
npm run smoke:model
```
