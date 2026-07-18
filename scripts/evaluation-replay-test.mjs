import assert from "node:assert/strict";
import { runEvaluationReplay } from "../lib/evaluation-replay.mjs";

const replay = await runEvaluationReplay();

assert.equal(replay.passed, true);
assert.equal(replay.passedCount, 45);
assert.equal(replay.total, 45);
assert.deepEqual(replay.groups.map((group) => group.total), [9, 24, 12]);
assert.ok(replay.groups.every((group) => group.passed));

console.log("PASS in-app Safety Replay executes 45 deterministic policy, Evidence Debt, and gate-to-review integrity checks.");
