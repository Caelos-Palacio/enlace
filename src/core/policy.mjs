import { createHash } from 'node:crypto';

export function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

export function fields(value, allowed, required = []) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !allowed.includes(key)) ||
    required.some(key => !Object.hasOwn(value, key))
  ) {
    throw failure('INVALID_INPUT', 'Unexpected or missing fields');
  }
  return value;
}

/** Clone, canonicalize and freeze bounded plain JSON without retaining host references. */
export function snapshot(value, maxBytes = 32768) {
  const ancestors = new Set();
  let count = 0;

  function walk(current, depth) {
    if (++count > 10000 || depth > 20) {
      throw failure('INPUT_LIMIT', 'JSON exceeds complexity limits');
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      return current;
    }
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (
      !current || typeof current !== 'object' ||
      (!Array.isArray(current) && ![Object.prototype, null].includes(Object.getPrototypeOf(current)))
    ) {
      throw failure('INVALID_INPUT', 'Only plain JSON values are accepted');
    }
    if (ancestors.has(current)) throw failure('INVALID_INPUT', 'Cyclic JSON is not accepted');
    ancestors.add(current);

    let result;
    if (Array.isArray(current)) {
      result = current.map(item => walk(item, depth + 1));
    } else {
      result = {};
      for (const key of Object.keys(current).sort()) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) {
          throw failure('INVALID_INPUT', 'Unsafe JSON key');
        }
        result[key] = walk(current[key], depth + 1);
      }
    }
    ancestors.delete(current);
    return Object.freeze(result);
  }

  const result = walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
    throw failure('INPUT_LIMIT', 'JSON exceeds byte limit');
  }
  return result;
}

export const hash = value => createHash('sha256')
  .update(JSON.stringify(snapshot(value, 131072)))
  .digest('hex');

export function targetUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) {
    throw failure('INVALID_TARGET', 'Explicit HTTP(S) target URL required');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw failure('INVALID_TARGET', 'Invalid target URL');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username || parsed.password || parsed.hash
  ) {
    throw failure('INVALID_TARGET', 'Target must be HTTP(S) without credentials or fragment');
  }
  return parsed.href;
}

export function checkPolicy(policy, adapter, capability, input) {
  if (policy.readOnly && capability.effect === 'write') {
    throw failure('POLICY_DENIED', 'Write operations are disabled');
  }
  if (policy.allowAdapter && !policy.allowAdapter(adapter.id, capability.id)) {
    throw failure('POLICY_DENIED', 'Adapter is disabled by host policy');
  }
  if (
    policy.allowTarget && input?.url &&
    !policy.allowTarget(targetUrl(input.url), adapter.id, capability.id)
  ) {
    throw failure('POLICY_DENIED', 'Target is disabled by host policy');
  }
}
