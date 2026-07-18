# Submission checklist

Complete these items before submitting to Devpost.

- [ ] Run `npm run check` and `npm run smoke:model`; save a terminal screenshot showing both pass.
- [ ] Before recording, use **Load clean jury demo** and confirm the reset, then use **Run bypass proof**. It intentionally erases only the local demo ledger, restores one curated field history, and exercises the real server-side Evidence Debt path.
- [ ] Record the under-three-minute demo using [DEMO.md](DEMO.md). Keep the audio factual: Codex/GPT-5.6 accelerated the build; Amazon Nova Pro is the live runtime evidence-summary provider.
- [ ] Capture four screenshots: the **NOT RELEASED** POS receipt with audit anchor, the three-lane Evidence Relay, the sealed Human Review Attestation that remains not released, and the 45-check Safety Replay.
- [ ] Verify the GitHub repository is public, `.env` remains untracked, the MIT license is present, and GitHub Actions has passed `npm run check`.
- [ ] Add the repository URL and use [SUBMISSION.md](SUBMISSION.md) as the Devpost description.
- [ ] In Codex, use `/feedback` for the session where most of the project was built, then paste that Session ID into Devpost.
- [ ] Do not claim disease diagnosis, yield gains, chemical advice, real customer deployment, or OpenAI API runtime inference. Describe the audit chain as a hackathon-prototype integrity feature—not compliance certification or immutable storage.

## Free reviewer path

The default case desk runs with no credentials: `npm run dev`, then open `http://localhost:3000`. The deterministic demo still creates the hold, review case, and field-ledger event. The live Nova path is optional and is verified separately with `npm run smoke:model`.
