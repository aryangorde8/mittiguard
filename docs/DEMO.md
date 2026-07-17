# MittiGuard demo — 2 minutes 40 seconds

Use the bundled demo case. Do not claim a real diagnosis, yield improvement, or regulatory approval.

## 0:00–0:20 — The moment that matters

“A farmer walks into an agri-input shop with yellowing chilli leaves. A typical app tries to name a disease and sell a product. MittiGuard does the opposite: it stops an unsupported sale at the counter.”

Show the case desk with the cart awaiting evidence.

## 0:20–0:50 — Evidence, not a confidence score

Point out the crop stage, reported symptom, stale Soil Health Card date, prior input outcome, simulated leaf attachment, and live weather card. Say: “A leaf symptom can conflict with soil and field history. The model summarizes that ambiguity; it does not diagnose or prescribe.”

## 0:50–1:20 — The visible intervention

Click **Run evidence gate**. Pause on the state change from “Cart awaiting evidence” to **PAUSED**.

Say: “The deterministic policy found two conflicts: yellowing with no current soil evidence, and a previous input that did not resolve the issue. The invoice is paused. No chemical recommendation is generated.”

## 1:20–1:45 — Model and determinism, deliberately separated

Show the evidence summary card. Explain: “Amazon Nova Pro reconciles the photo and structured context into a human-readable evidence summary. The policy engine—not the model—controls the sale state. A model response cannot clear the hold.”

If the key is configured, the header shows **Amazon Nova Pro evidence path active**. Otherwise state that the offline demo path is running and show `npm run smoke:model` in the terminal separately after configuring the key.

## 1:45–2:10 — Memory changes the next sale

Open **Field memory**. Point to the failed previous input and the new “Input sale paused” event. Say: “This is not a one-off chat. If the farmer returns, the ledger prevents the same unresolved problem from becoming another sale.”

## 2:10–2:30 — Human ownership stays intact

Open **Extension queue** and click **Mark evidence received**. The button records evidence but the state remains **SALE STILL ON HOLD**.

Say: “A reviewer owns the next step. Receiving evidence does not silently turn a hold into a product approval.”

## 2:30–2:40 — Proof and close

Open **Safety bench**. Say: “Eight policy fixtures, including stale soil data, missing photos, failed repeats, and a prompt-injection attempt, all end in a hold or human review. That is the claim we can stand behind.”

End: “MittiGuard does not help dealers sell more inputs. It helps them avoid selling blind.”
