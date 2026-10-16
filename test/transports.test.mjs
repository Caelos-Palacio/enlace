import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const decode = result => result.structuredContent ?? JSON.parse(result.content.find(block => block.type === 'text').text);

async function fixture(t) {
  const requests = [];
  let started;
  let closed;
  const slowStarted = new Promise(resolve => { started = resolve; });
  const slowClosed = new Promise(resolve => { closed = resolve; });
  const timers = new Set();
  const server = createServer((request, response) => {
    requests.push({ url: request.url, method: request.method, headers: request.headers });
    if (request.url === '/slow-docs') {
      response.setHeader('Content-Type', 'text/plain');
      response.write('Beginning of documentation. ');
      started();
      response.on('close', closed);
      const timer = setTimeout(() => { timers.delete(timer); response.end('Late documentation.'); }, 300);
      timers.add(timer);
    } else if (request.url === '/docs') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<h1>Fixture API documentation</h1><p>GET /items returns a public JSON fixture.</p>');
    } else if (request.url === '/unauthorized') {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'login_required' }));
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ items: ['public'], method: request.method }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests, slowStarted, slowClosed,
  };
}

async function mcp(t) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp', '--allow-local'],
    cwd: root,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'enlace-integration-fixture', version: '1.0.0' });
  let diagnostics = '';
  transport.stderr?.on('data', chunk => { diagnostics += chunk.toString(); });
  t.after(async () => {
    await client.close();
    assert.equal(diagnostics, '', 'MCP stdout is protocol only and stderr has no unexpected diagnostics');
  });
  await client.connect(transport);
  return client;
}

const researchArgs = (url, target = `${url}/items`, source = `${url}/docs`) => ({
  adapter: 'http-json', operation: 'request', target,
  sourceUrls: [source], reason: 'The fixture documentation describes the requested public endpoint.',
});
const planArgs = target => ({ adapter: 'http-json', operation: 'request', input: { url: target } });
const call = (client, name, args, options) => client.callTool({ name, arguments: args }, options);

async function session(t, args = []) {
  const child = spawn(process.execPath, [cli, 'session', ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const queue = [];
  const waiters = [];
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
  lines.on('line', line => {
    const value = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter(value); else queue.push(value);
  });
  t.after(() => { lines.close(); child.kill(); });
  return {
    request(value) {
      child.stdin.write(JSON.stringify(value) + '\n');
      return queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve));
    },
    async finish() {
      child.stdin.end();
      const [code] = await once(child, 'close');
      assert.equal(code, 0);
      assert.equal(diagnostics, '');
    },
  };
}

test('real MCP stdio advertises four tools and shares research/one-use plans', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const client = await mcp(t);
  assert.deepEqual(client.getServerVersion(), { name: 'enlace', version: '0.1.0' });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
    'enlace_capabilities', 'enlace_execute', 'enlace_plan', 'enlace_research',
  ]);
  const metadata = decode(await call(client, 'enlace_capabilities', {}));
  assert(metadata.adapters.some(adapter => adapter.id === 'http-json'));
  assert.equal(f.requests.length, 0, 'listing capabilities must not connect to apps');
  const before = await call(client, 'enlace_plan', planArgs(`${f.url}/items`));
  assert.equal(before.isError, true);
  assert.equal(decode(before).code, 'RESEARCH_REQUIRED');
  const researched = decode(await call(client, 'enlace_research', researchArgs(f.url)));
  assert.equal(researched.receipt.grantsPermissions, false);
  assert.match(researched.observations[0].excerpt, /GET \/items/);
  assert.equal(researched.observations[0].untrusted, true);
  const other = await call(client, 'enlace_plan', planArgs(`${f.url}/items?different=1`));
  assert.equal(decode(other).code, 'RESEARCH_REQUIRED');
  const plan = decode(await call(client, 'enlace_plan', planArgs(`${f.url}/items`)));
  const executed = decode(await call(client, 'enlace_execute', { planId: plan.planId }));
  assert.equal(executed.ok, true);
  assert.equal(executed.untrusted, true);
  assert.deepEqual(executed.data.data.items, ['public']);
  const repeated = await call(client, 'enlace_execute', { planId: plan.planId });
  assert.equal(repeated.isError, true);
  assert.equal(decode(repeated).code, 'UNKNOWN_PLAN');
  assert.equal(f.requests.filter(request => request.url === '/items').length, 1);
});

test('MCP denies mutation/auth/extra arguments and marks HTTP 401 as tool error', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const client = await mcp(t);
  await call(client, 'enlace_research', researchArgs(f.url, `${f.url}/unauthorized`));
  const p = decode(await call(client, 'enlace_plan', planArgs(`${f.url}/unauthorized`)));
  const result = await call(client, 'enlace_execute', { planId: p.planId });
  assert.equal(result.isError, true);
  assert.equal(decode(result).ok, false);
  assert.equal(decode(result).data.status, 401);
  for (const input of [
    { url: `${f.url}/items`, method: 'POST' },
    { url: `${f.url}/items`, headers: { Authorization: 'not-a-real-secret' } },
    { url: `${f.url}/items`, body: { title: 'do not send' } },
  ]) {
    const denied = await call(client, 'enlace_plan', { adapter: 'http-json', operation: 'request', input });
    assert.equal(denied.isError, true);
    assert.equal(decode(denied).code, 'NO_ROUTE');
  }
  const extra = await call(client, 'enlace_execute', { planId: p.planId, authorize: true });
  assert.equal(extra.isError, true);
  assert(f.requests.every(request => request.method === 'GET' && !request.headers.authorization && !request.headers.cookie));
});

test('real MCP cancellation reaches HTTP signal and cannot mint late research', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const client = await mcp(t);
  const controller = new AbortController();
  const pending = call(client, 'enlace_research', researchArgs(f.url, `${f.url}/items`, `${f.url}/slow-docs`), { signal: controller.signal });
  await f.slowStarted;
  controller.abort();
  await assert.rejects(pending);
  let deadline;
  try {
    await Promise.race([
      f.slowClosed,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('MCP cancellation did not close the HTTP request')), 2000);
      }),
    ]);
  } finally { clearTimeout(deadline); }
  await delay(350);
  const plan = await call(client, 'enlace_plan', planArgs(`${f.url}/items`));
  assert.equal(plan.isError, true);
  assert.equal(decode(plan).code, 'RESEARCH_REQUIRED');
  assert.equal(f.requests.length, 1, 'cancellation must not trigger a retry or another source');
});

test('CLI help has no connections; run is one-process research and execution', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const help = await run(process.execPath, [cli], { cwd: root });
  assert.match(help.stdout, /research-first/);
  assert.equal(help.stderr, '');
  assert.equal(f.requests.length, 0);
  const result = await run(process.execPath, [cli, '--allow-local', 'run', '--adapter', 'http-json', '--operation', 'request',
    '--input', JSON.stringify({ url: `${f.url}/items` }), '--sources', JSON.stringify([`${f.url}/docs`]), '--reason', 'Fixture API documentation'], { cwd: root });
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(result.stderr, '');
  assert.deepEqual(f.requests.map(request => request.url), ['/docs', '/items']);
  await assert.rejects(run(process.execPath, [cli, 'run'], { cwd: root }), error => error.code === 1 && /requires/.test(error.stderr));
});

test('CLI JSON Lines retains plans, rejects invalid fields, and supports explicit trusted config', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const stream = await session(t, ['--allow-local']);
  assert((await stream.request({ id: 1, method: 'capabilities' })).result.adapters.length >= 2);
  const before = await stream.request({ id: 2, method: 'plan', params: planArgs(`${f.url}/items`) });
  assert.equal(before.error.code, 'RESEARCH_REQUIRED');
  const evidence = await stream.request({ id: 3, method: 'research', params: researchArgs(f.url) });
  assert.match(evidence.result.observations[0].excerpt, /Fixture API/);
  const prepared = await stream.request({ id: 4, method: 'plan', params: planArgs(`${f.url}/items`) });
  const executed = await stream.request({ id: 5, method: 'execute', params: { planId: prepared.result.planId } });
  assert.equal(executed.result.ok, true);
  const repeated = await stream.request({ id: 6, method: 'execute', params: { planId: prepared.result.planId } });
  assert.equal(repeated.error.code, 'UNKNOWN_PLAN');
  const invalid = await stream.request({ id: 7, method: 'capabilities', unknown: true });
  assert.equal(invalid.error.ok, false);
  await stream.finish();

  const directory = await mkdtemp(join(tmpdir(), 'enlace-host-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, 'host.mjs');
  await writeFile(config, `import {createEnlace} from ${JSON.stringify(pathToFileURL(join(root, 'src/index.mjs')).href)};
export function createRuntime() { return createEnlace({adapters:[{id:'fixture-config',version:'1',kind:'test',capabilities:[{id:'read',effect:'read',requiresResearch:false,cost:1,inputSchema:{type:'object',additionalProperties:false}}],execute:async()=>({configured:true})}]}); }
`);
  const configured = await run(process.execPath, [cli, 'run', '--config', config, '--adapter', 'fixture-config', '--operation', 'read', '--input', '{}'], { cwd: root });
  assert.equal(JSON.parse(configured.stdout).data.configured, true);
  const configuredSession = await session(t, ['--config', config]);
  const capabilities = await configuredSession.request({ id: 'host', method: 'capabilities' });
  assert.equal(capabilities.result.adapters[0].id, 'fixture-config');
  await configuredSession.finish();
});
