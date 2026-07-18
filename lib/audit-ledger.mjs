import { createHash, createHmac, randomUUID } from "node:crypto";

const GENESIS_HASH = "GENESIS";
const LEDGER_VERSION = 1;
const SEALED_ALGORITHM = "HMAC-SHA256";
const DEVELOPMENT_ALGORITHM = "SHA-256 (development only)";

function auditSecret() {
  return String(process.env.MITTIGUARD_AUDIT_SECRET || "");
}

function canonicalEntry(entry) {
  return JSON.stringify({
    version: LEDGER_VERSION,
    sequence: entry.sequence,
    id: entry.id,
    caseId: entry.caseId,
    auditId: entry.auditId,
    at: entry.at,
    actor: entry.actor,
    kind: entry.kind,
    event: entry.event,
    detail: entry.detail,
    saleState: entry.saleState,
    policyVersion: entry.policyVersion,
    previousHash: entry.previousHash
  });
}

function digest(entry, { secret = auditSecret(), sealed = Boolean(secret) } = {}) {
  const payload = canonicalEntry(entry);
  return sealed
    ? createHmac("sha256", secret).update(payload).digest("hex").toUpperCase()
    : createHash("sha256").update(payload).digest("hex").toUpperCase();
}

function ledgerId() {
  return `MGL-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

export function createAuditLedger({ migratedFromVersion = null, purpose = "runtime", coverage = null, seedHistoryUnsealed = false } = {}) {
  const sealed = Boolean(auditSecret());
  return {
    version: LEDGER_VERSION,
    ledgerId: ledgerId(),
    algorithm: sealed ? SEALED_ALGORITHM : DEVELOPMENT_ALGORITHM,
    sealed,
    createdAt: new Date().toISOString(),
    purpose,
    migratedFromVersion,
    coverage: coverage || (migratedFromVersion ? "FROM_MIGRATION_FORWARD" : "FULL_LEDGER"),
    seedHistoryUnsealed: Boolean(seedHistoryUnsealed),
    headHash: GENESIS_HASH,
    entries: []
  };
}

export function ensureAuditLedger(data, options = {}) {
  if (!data.auditLedger || !Array.isArray(data.auditLedger.entries)) {
    data.auditLedger = createAuditLedger({
      migratedFromVersion: data.version && data.version < 3 ? data.version : null,
      purpose: options.purpose || "runtime"
    });
  }
  return data.auditLedger;
}

export function resetAuditLedger(data) {
  data.auditLedger = createAuditLedger({
    migratedFromVersion: null,
    purpose: "jury-demo-reset",
    // The reset fixture deliberately includes curated field history. The new
    // HMAC chain proves only relay events written after this reset, not those
    // seed-history records.
    coverage: "FROM_DEMO_RESET_FORWARD",
    seedHistoryUnsealed: true
  });
  return data.auditLedger;
}

export function appendLedgerEntry(data, record, auditEvent) {
  const ledger = ensureAuditLedger(data);
  const sealed = Boolean(auditSecret());
  const sequence = ledger.entries.length + 1;
  const entry = {
    version: LEDGER_VERSION,
    sequence,
    id: `L-${String(sequence).padStart(8, "0")}`,
    caseId: record.id,
    auditId: auditEvent.id,
    at: auditEvent.at,
    actor: auditEvent.actor,
    kind: auditEvent.kind,
    event: auditEvent.event,
    detail: auditEvent.detail,
    saleState: record.saleState,
    policyVersion: record.policyVersion,
    previousHash: ledger.headHash || GENESIS_HASH,
    algorithm: sealed ? SEALED_ALGORITHM : DEVELOPMENT_ALGORITHM,
    sealed
  };
  entry.hash = digest(entry, { sealed });
  ledger.entries.push(entry);
  ledger.headHash = entry.hash;
  ledger.algorithm = sealed ? SEALED_ALGORITHM : ledger.algorithm;
  ledger.sealed = ledger.entries.every((item) => item.sealed === true);

  auditEvent.ledgerSequence = entry.sequence;
  auditEvent.previousHash = entry.previousHash;
  auditEvent.hash = entry.hash;
  auditEvent.sealed = entry.sealed;
  return entry;
}

function findMirroredAuditEvent(data, entry) {
  const record = data.cases?.find((item) => item.id === entry.caseId);
  return record?.relay?.audit?.find((item) => item.id === entry.auditId) || null;
}

function auditMatchesEntry(event, entry) {
  return Boolean(event)
    && event.id === entry.auditId
    && event.at === entry.at
    && event.actor === entry.actor
    && event.kind === entry.kind
    && event.event === entry.event
    && event.detail === entry.detail
    && event.ledgerSequence === entry.sequence
    && event.previousHash === entry.previousHash
    && event.hash === entry.hash;
}

export function verifyAuditLedger(data, { caseId = null } = {}) {
  const ledger = data.auditLedger;
  if (!ledger || !Array.isArray(ledger.entries)) {
    return {
      valid: true,
      sealed: false,
      coverage: "NO_LEDGER_YET",
      ledgerId: null,
      algorithm: null,
      entryCount: 0,
      caseEntryCount: 0,
      caseLastSequence: null,
      headHash: null,
      checkedAt: new Date().toISOString()
    };
  }

  let previousHash = GENESIS_HASH;
  let valid = true;
  let firstInvalidSequence = null;
  for (const [index, entry] of ledger.entries.entries()) {
    const sequenceValid = entry.sequence === index + 1 && entry.id === `L-${String(index + 1).padStart(8, "0")}`;
    const previousValid = entry.previousHash === previousHash;
    const hashValid = entry.hash === digest(entry, { sealed: entry.sealed === true });
    const mirrorValid = auditMatchesEntry(findMirroredAuditEvent(data, entry), entry);
    if (!sequenceValid || !previousValid || !hashValid || !mirrorValid) {
      valid = false;
      firstInvalidSequence ??= index + 1;
    }
    previousHash = entry.hash;
  }

  if ((ledger.headHash || GENESIS_HASH) !== previousHash) {
    valid = false;
    firstInvalidSequence ??= ledger.entries.length || 1;
  }

  const caseEntries = caseId ? ledger.entries.filter((entry) => entry.caseId === caseId) : ledger.entries;
  const sealed = ledger.entries.length > 0 && ledger.entries.every((entry) => entry.sealed === true);
  return {
    valid,
    sealed,
    coverage: ledger.coverage || (ledger.migratedFromVersion ? "FROM_MIGRATION_FORWARD" : "FULL_LEDGER"),
    seedHistoryUnsealed: ledger.seedHistoryUnsealed === true,
    ledgerId: ledger.ledgerId,
    algorithm: sealed ? SEALED_ALGORITHM : DEVELOPMENT_ALGORITHM,
    entryCount: ledger.entries.length,
    caseEntryCount: caseEntries.length,
    caseLastSequence: caseEntries.at(-1)?.sequence || null,
    headHash: ledger.headHash || GENESIS_HASH,
    firstInvalidSequence,
    checkedAt: new Date().toISOString()
  };
}
