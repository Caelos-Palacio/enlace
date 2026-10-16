import { randomUUID } from 'node:crypto';
import { failure, hash, snapshot } from './policy.mjs';

export function createResearchLedger({ clock = Date.now, ttlMs = 300000, maxEntries = 256 } = {}) {
  const records = new Map();
  const key = (adapter, operation, schemaHash, target) =>
    JSON.stringify([adapter, operation, schemaHash, target]);

  return {
    get(adapter, operation, schemaHash, target) {
      const recordKey = key(adapter, operation, schemaHash, target);
      const entry = records.get(recordKey);
      if (entry && entry.expiresAt > clock()) return entry;
      records.delete(recordKey);
      return undefined;
    },

    record({ adapter, operation, schemaHash, target, sources, reason }) {
      if (!sources.length || !reason) {
        throw failure('RESEARCH_REQUIRED', 'Successful sources and rationale are required');
      }
      if (records.size >= maxEntries) records.delete(records.keys().next().value);
      const entry = snapshot({
        id: randomUUID(),
        adapter,
        operation,
        schemaHash,
        target,
        sources,
        reason,
        checkedAt: clock(),
        expiresAt: clock() + ttlMs,
        grantsPermissions: false,
        provesOfficialSource: false,
      }, 131072);
      records.set(key(adapter, operation, schemaHash, target), entry);
      return entry;
    },

    clear() {
      records.clear();
    },
  };
}

function sourceContent(result) {
  return typeof result?.text === 'string' ? result.text : result?.data;
}

export function sourceEvidence(url, result) {
  const status = result?.status ?? result?.statusCode;
  const content = sourceContent(result);
  const nonempty = typeof content === 'string'
    ? content.trim().length > 0
    : content !== null && content !== undefined;

  if (
    result?.ok !== true || result?.isError === true || !Number.isInteger(status) ||
    status < 200 || status >= 300 || !nonempty
  ) {
    throw failure('SOURCE_FAILED', 'Research source did not return successful nonempty content');
  }
  return { url, status, contentHash: hash(snapshot(content, 131072)) };
}

/** Return useful documentation fragments without putting their instructions in authority metadata. */
export function sourceObservation(url, result) {
  const content = sourceContent(result);
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    url,
    status: result.status ?? result.statusCode,
    format: typeof content === 'string' ? 'text' : 'json',
    excerpt: text.slice(0, 4000),
    truncated: result.truncated === true || text.length > 4000,
    untrusted: true,
  };
}
