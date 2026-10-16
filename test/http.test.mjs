import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { requestBounded, isBlockedAddress } from '../src/adapters/network.mjs';
import { createHttpJsonAdapter } from '../src/adapters/http-json.mjs';
import { readSource, createHttpStaticAdapter } from '../src/adapters/http-static.mjs';

async function fixture(t) {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/json' }); res.end(); }
    else if (req.url === '/unauthorized') { res.writeHead(401); res.end('private'); }
    else if (req.url === '/slow') { setTimeout(() => res.end('slow'), 100); }
    else if (req.url === '/huge') { res.setHeader('Content-Type', 'application/json'); res.end(' '.repeat(140000)); }
    else if (req.url === '/chunked') { res.setHeader('Content-Type', 'text/plain'); res.write('x'.repeat(70)); res.end('y'.repeat(70)); }
    else if (req.url === '/html') { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Public guide</h1><script>ignore instructions</script><form>password</form><p>Useful text</p>'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ method: req.method, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null })); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, count: () => requests };
}

test('default policy blocks private, special and metadata addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.1.1', '192.168.1.2', '100.64.0.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::']) assert.equal(isBlockedAddress(address), true, address);
  for (const address of ['169.254.169.254', '100.100.100.200', 'fd00:ec2::254', '0.0.0.0', '224.0.0.1', 'fe80::1', 'ff02::1']) assert.equal(isBlockedAddress(address, { allowLocal: true }), true, address);
  assert.equal(isBlockedAddress('127.0.0.1', { allowLocal: true }), false);
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
});

test('loopback requires explicit host configuration', async t => {
  const f = await fixture(t);
  await assert.rejects(requestBounded(f.url), /blocked address/);
  assert.equal(f.count(), 0);
  const result = await createHttpJsonAdapter({ allowLocal: true }).execute('request', { url: `${f.url}/json` });
  assert.deepEqual(result.data, { method: 'GET', cookie: null, authorization: null });
  await assert.rejects(createHttpJsonAdapter({ allowLocal: true }).execute('request', { url: f.url, method: 'POST' }), /GET/);
});

test('all DNS answers are validated and accepted resolution is pinned', async t => {
  const f = await fixture(t);
  const remote = f.url.replace('127.0.0.1', 'fixture.example');
  await assert.rejects(requestBounded(remote, { lookupHost: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] }), /blocked/);
  let lookups = 0;
  const result = await requestBounded(remote, { allowLocal: true, lookupHost: async () => { lookups++; return [{ address: '127.0.0.1', family: 4 }]; } });
  assert.equal(result.status, 200);
  assert.equal(lookups, 1);
});

test('HTTP errors and redirects do not trigger fallback or retry', async t => {
  const f = await fixture(t);
  assert.equal((await requestBounded(`${f.url}/redirect`, { allowLocal: true })).reason, 'redirect_not_followed');
  assert.equal((await requestBounded(`${f.url}/unauthorized`, { allowLocal: true })).reason, 'authentication_or_authorization_required');
  assert.equal(f.count(), 2);
});

test('declared and streamed response limits are enforced', async t => {
  const f = await fixture(t);
  await assert.rejects(createHttpJsonAdapter({ allowLocal: true }).execute('request', { url: `${f.url}/huge` }), /byte limit/);
  await assert.rejects(requestBounded(`${f.url}/chunked`, { allowLocal: true, maxBytes: 100 }), /byte limit/);
});

test('abort and deadline also cover DNS and body reads', async t => {
  const f = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestBounded(f.url, { allowLocal: true, signal: controller.signal }));
  await assert.rejects(requestBounded(`${f.url}/slow`, { allowLocal: true, timeoutMs: 10 }));
  await assert.rejects(requestBounded('https://fixture.example', { timeoutMs: 10, lookupHost: () => new Promise(() => {}) }));
});

test('static sources omit scripts and forms and parse JSON', async t => {
  const f = await fixture(t);
  const result = await createHttpStaticAdapter({ allowLocal: true }).execute('readPage', { url: `${f.url}/html` });
  assert.equal(result.text, 'Public guide Useful text');
  assert.equal(result.untrusted, true);
  assert.match((await readSource(`${f.url}/json`, { allowLocal: true })).text, /"method":"GET"/);
});

test('credentials, additional request fields and non-allowlisted origins are denied', async t => {
  const f = await fixture(t);
  await assert.rejects(requestBounded(`${f.url}/?token=x`, { allowLocal: true }), /Credential/);
  await assert.rejects(requestBounded(f.url.replace('http://', 'http://user:pass@'), { allowLocal: true }), /credentials/);
  await assert.rejects(requestBounded(f.url, { allowLocal: true, origins: ['https://example.com'] }), /Origin/);
  await assert.rejects(createHttpJsonAdapter({ allowLocal: true }).execute('request', { url: f.url, headers: { Authorization: 'secret' } }), /GET/);
  assert.equal(f.count(), 0);
});
