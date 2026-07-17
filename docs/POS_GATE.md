# MittiGuard POS Gate v1

MittiGuard exposes a small counter-system boundary. A billing/POS system submits a proposed input sale; MittiGuard opens the evidence relay and returns a receipt that **never releases the sale automatically**.

## Request

```http
POST /api/pos/authorize-sale
Content-Type: application/json
```

```json
{
  "invoiceId": "POS-INV-8841",
  "case": {
    "farmerName": "Asha Reddy",
    "fieldId": "GNT-14 · North plot",
    "crop": "Chilli",
    "cropStage": "Flowering",
    "requestType": "pesticide",
    "symptom": "Yellowing lower leaves after rain",
    "photoProvided": true,
    "soilReportDate": "2024-01-11",
    "lastInput": "Previous input, 10 days ago",
    "previousInputFailed": false
  }
}
```

## Response contract

```json
{
  "receipt": {
    "contract": "MittiGuard POS Gate v1",
    "invoiceId": "POS-INV-8841",
    "saleAuthorization": "NOT_RELEASED",
    "saleState": "ON_HOLD",
    "policyVersion": "MG-1.0",
    "evidenceCaseId": "C-0001",
    "handoffCode": "MG-0001-GNT14",
    "decisionDigest": "…"
  }
}
```

`decisionDigest` is an integrity fingerprint for the receipt payload, not a payment signature. The POS must treat both `ON_HOLD` and `REQUIRES_HUMAN_REVIEW` as **not released**. A qualified reviewer owns any later operational step; MittiGuard has no approved-sale response.

The Case Intake screen uses this contract itself, so the visible demo follows the same product boundary documented here.
