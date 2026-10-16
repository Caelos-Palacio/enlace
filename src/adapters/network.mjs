import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function ipv6Bytes(address) {
  let value = address.toLowerCase().split('%')[0];
  if (value.includes('.')) {
    const start = value.lastIndexOf(':');
    const bytes = value.slice(start + 1).split('.').map(Number);
    value = `${value.slice(0, start)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return words.flatMap(word => [parseInt(word, 16) >> 8, parseInt(word, 16) & 255]);
}

export function isBlockedAddress(address, { allowLocal = false } = {}) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if ((a === 100 && b === 100 && c === 100 && address.endsWith('.200')) || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 192 && b === 0 && c === 0)) return true;
    const local = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    if (local) return !allowLocal;
    return (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113);
  }
  if (family !== 6 || address.includes('%')) return true;
  const bytes = ipv6Bytes(address);
  if (bytes.slice(0, 10).every(x => x === 0) && bytes[10] === 255 && bytes[11] === 255) return isBlockedAddress(bytes.slice(12).join('.'), { allowLocal });
  if (bytes[0] === 253 && bytes[1] === 0 && bytes[2] === 14 && bytes[3] === 194) return true;
  const loopback = bytes.slice(0, 15).every(x => x === 0) && bytes[15] === 1;
  if (loopback || (bytes[0] & 254) === 252) return !allowLocal;
  if ((bytes[0] & 224) !== 32) return true;
  // Documentation and transition mechanisms can hide non-public IPv4 destinations.
  return (bytes[0] === 32 && bytes[1] === 1 && bytes[2] === 13 && bytes[3] === 184) || (bytes[0] === 32 && bytes[1] === 2) || (bytes[0] === 32 && bytes[1] === 1 && bytes[2] === 0);
}

export function validateUrl(value, { origins } = {}) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('URL must be a string of at most 4096 characters');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) URLs without credentials are supported');
  if (url.hash) throw new Error('URL fragments are not supported');
  if (origins && !origins.includes(url.origin)) throw new Error('Origin is not allowed');
  for (const key of url.searchParams.keys()) if (/^(?:authorization|cookie|password|passwd|secret|token|access_token|refresh_token|api[-_]?key|key|signature|sig|x-amz-.+|x-goog-.+)$/i.test(key)) throw new Error('Credential query parameters are not supported');
  return url;
}

export async function requestBounded(value, { signal, allowLocal = false, origins, lookupHost = lookup, timeoutMs = 10000, maxBytes = 524288, accept = 'text/html,application/json;q=0.9' } = {}) {
  const url = validateUrl(value, { origins });
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.min(10000, Math.max(1, timeoutMs)))]);
  deadline.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await new Promise((resolve, reject) => {
    const abort = () => reject(deadline.reason);
    deadline.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => isIP(host) ? [{ address: host, family: isIP(host) }] : lookupHost(host, { all: true })).then(resolve, reject).finally(() => deadline.removeEventListener('abort', abort));
  });
  deadline.throwIfAborted();
  if (!addresses.length || addresses.some(item => isBlockedAddress(item.address, { allowLocal }))) throw new Error('Host resolves to a blocked address');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; error ? reject(error) : resolve(result); };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', signal: deadline, agent: false, rejectUnauthorized: true,
      headers: { Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'Enlace/0.1' },
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, isIP(pinned.address)),
    }, response => {
      const status = response.statusCode ?? 0;
      const base = { url: url.href, status, headers: { 'content-type': String(response.headers['content-type'] ?? '') }, untrusted: true };
      if (status < 200 || status >= 300) {
        response.destroy();
        finish(null, { ...base, ok: false, body: '', reason: [401, 403].includes(status) ? 'authentication_or_authorization_required' : status >= 300 && status < 400 ? 'redirect_not_followed' : 'http_error' });
        return;
      }
      if (String(response.headers['content-encoding'] ?? 'identity').toLowerCase() !== 'identity') { finish(new Error('Compressed responses are not supported')); response.destroy(); return; }
      if (Number(response.headers['content-length']) > maxBytes) { finish(new Error('Response exceeds byte limit')); response.destroy(); return; }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { finish(new Error('Response exceeds byte limit')); response.destroy(); } else chunks.push(chunk); });
      response.on('end', () => finish(null, { ...base, ok: true, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', error => finish(error));
      response.on('aborted', () => finish(new Error('Response was interrupted')));
    });
    req.on('error', error => finish(error));
    req.end();
  });
}
