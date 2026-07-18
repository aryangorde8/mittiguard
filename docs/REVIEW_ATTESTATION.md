# Human Review Attestation

MittiGuard can record a one-time human review attestation for a POS-bound
evidence case. It is deliberately **not** a sale approval. Every successful
response contains `saleAuthorization: "NOT_RELEASED"`; MittiGuard has no
endpoint, state, or UI action that releases an invoice.

## What is bound

Before the attestation is written, the server creates a preview of the exact
evidence packet and audit state the reviewer is about to attest:

```http
GET /api/cases/C-0001/review-attestation/preview
```

The preview includes:

- a SHA-256 digest of the reviewed evidence packet (field, crop, stage,
  symptom, image-presence flag, soil date, last-input context, transcript
  fingerprint, required tasks, and task-completion notes);
- the current HMAC audit anchor (ledger ID, ledger version, algorithm, coverage, head hash,
  and latest sequence for that case); and
- eligibility issues, if any.

Raw image bytes and the audit secret are never put in this snapshot or the
ledger.

The reviewer then posts the server-calculated digest and audit head back with
their identity and neutral disposition:

```http
POST /api/cases/C-0001/review-attestation
Content-Type: application/json

{
  "reviewerName": "Jury Demo Reviewer",
  "disposition": "MANUAL_POS_DECISION_REQUIRED",
  "note": "Evidence packet reviewed; any later POS decision is outside MittiGuard.",
  "confirmed": true,
  "expectedEvidenceDigest": "<from preview>",
  "expectedAuditHeadHash": "<from preview>"
}
```

The server rejects the request if the evidence or audit head changed after the
preview (`409`), a task remains open, the case is not from the POS Gate, the
reviewer is unnamed or differs from the assigned extension-review owner, the
ledger is not valid and HMAC-sealed, or the caller supplies any sale-state or
authorization field.

## Immutable review record

The stored attestation includes a binding digest and the pre-attestation audit
anchor. Its matching audit event is HMAC-linked to the preceding ledger hash.
Verification checks the evidence digest, binding digest, reviewer ownership,
POS invoice binding, exact audit event, and current sealed ledger integrity.

After attestation, evidence tasks and reviewer ownership are frozen. A neutral
field observation may then be recorded for future Field Memory only. It does
not change the current invoice state.

## Jury-demo boundary

The public instance is an explicitly synthetic jury demo. A reviewer identity
entered there is a **synthetic demo identity**, not a legal signature or real
authentication. Production use would require identity, role management, a
durable multi-user store, and an authenticated review service. Set a stable
`MITTIGUARD_AUDIT_SECRET` before a production-like ledger is created; without
it the review attestation intentionally refuses to run.
