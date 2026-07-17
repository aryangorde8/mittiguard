# Submission checklist

Complete these items before submitting to Devpost.

- [ ] Run `npm run check` and `npm run smoke:model`; save a terminal screenshot showing both pass.
- [ ] Record the under-three-minute demo using [DEMO.md](DEMO.md). Keep the audio factual: Codex/GPT-5.6 accelerated the build; Amazon Nova Pro is the live runtime evidence-summary provider.
- [ ] Capture three screenshots: the paused sale, field memory, and evidence-received case that remains on hold.
- [ ] Create a GitHub repository, keep `.env` untracked, and choose a license you are comfortable applying before making it public.
- [ ] Add the repository URL and use [SUBMISSION.md](SUBMISSION.md) as the Devpost description.
- [ ] In Codex, use `/feedback` for the session where most of the project was built, then paste that Session ID into Devpost.
- [ ] Do not claim disease diagnosis, yield gains, chemical advice, real customer deployment, or OpenAI API runtime inference.

## Free reviewer path

The default case desk runs with no credentials: `npm run dev`, then open `http://localhost:3000`. The deterministic demo still creates the hold, review case, and field-ledger event. The live Nova path is optional and is verified separately with `npm run smoke:model`.
