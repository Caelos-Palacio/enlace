# Enlace

Research-first application connections for agents. Independent of models, agent frameworks and terminals.

Enlace is a small Node.js SDK with CLI, JSON Lines and MCP transports. It separates learning an application's interface, choosing a route, planning an exact operation and executing it. The same core handles each transport; no LLM, account or background service is required.

**Status: 0.1.0, experimental.** Working built-ins are public HTTP JSON, static HTML/JSON/text and host-configured CLIs. Browser UI, native desktop control, OAuth and automatic connector generation are extension points, not built-in capabilities. The earlier Pi/Warp installation is a separate local integration and is not bundled here.

[Español](README.es.md) · [Architecture](docs/architecture.md) · [Core contract](docs/core-contract.md) · [Security](SECURITY.md)

## Install from source

Requires Node.js 22 or newer. No browser or model is downloaded.

```sh
git clone https://github.com/Caelos-Palacio/enlace.git
cd enlace
npm ci --ignore-scripts
node src/cli.mjs capabilities
npm test
```

This release is published on GitHub, not the npm registry. For a local command, use `npm link`, or run `node src/cli.mjs` directly. Do not replace another installed `enlace` command unless you intend to switch installations.

## Research → plan → execute

```js
import {createDefaultEnlace} from './src/index.mjs';

const enlace = createDefaultEnlace();
const target = 'https://api.example.com/items'; // Replace with your real API.
await enlace.research({
  adapter: 'http-json', operation: 'request', target,
  sourceUrls: ['https://docs.example.com/items'],
  reason: 'The API reference documents GET /items and its response fields.',
});
const plan = enlace.plan({
  adapter: 'http-json', operation: 'request', input: {url: target},
});
const result = await enlace.execute({planId: plan.planId});
```

The example domains are placeholders, not a working service. All requested sources must return HTTP 2xx and nonempty content. Research returns bounded excerpts and records source hashes with the exact adapter, schema, operation and target URL for up to five minutes. **A successful read does not prove that a source is official or semantically relevant.** The supplied rationale is recorded, not independently verified. Use an agent's existing search tool to find documentation; Enlace accepts explicit sources and does not bundle a search provider.

Plans snapshot validated input, expire after five minutes and are consumed once before execution or authorization. Routing considers eligible, researched adapters and their declared relative cost; this is configuration, not a runtime performance benchmark. Ties are reported as alternatives with deterministic selection. No retries or automatic API-to-UI fallback occur.

### CLI

```sh
node src/cli.mjs run --adapter http-json --operation request \
  --input '{"url":"https://api.example.com/items"}' \
  --sources '["https://docs.example.com/items"]' \
  --reason 'API reference for the requested endpoint'
```

`run` performs research, planning and execution in one process. `session` keeps memory between JSON Lines requests:

```json
{"id":1,"method":"capabilities","params":{}}
```

Methods are `capabilities`, `research`, `plan` and `execute`, using the SDK arguments above. End every request with a newline. Separate processes do not share research or plan IDs. `--allow-local` explicitly permits LAN/loopback destinations; metadata and link-local addresses remain blocked. Repeat `--origin https://host.example` to restrict origins, including documentation sources.

### MCP

Configure a client using its own MCP registration format. A common `mcpServers` form is:

```json
{
  "mcpServers": {
    "enlace": {
      "command": "node",
      "args": ["/absolute/path/to/enlace/src/cli.mjs", "mcp"]
    }
  }
}
```

Four tools share one in-memory runtime: `enlace_capabilities`, `enlace_research`, `enlace_plan`, `enlace_execute`. Operation schemas are discovered on demand. Default adapters only read, require no accounts and do not expose commands, module loading or authorization parameters. The server runs over stdio and opens no listening port. Cancellation is propagated through the MCP SDK. No Pi or provider session is loaded.

## Add a trusted adapter

An adapter declares its ID/version/kind and operation capabilities: JSON Schema, `effect`, `requiresResearch` and relative `cost`. The host registers adapter code; tool requests cannot install or import modules. The core validates inputs without coercion and marks outputs as untrusted data.

```js
import {createEnlace} from './src/index.mjs';
import {createGitStatusAdapter} from './examples/custom-adapter.mjs';
const enlace = createEnlace({
  adapters: [createGitStatusAdapter(process.cwd())],
  policy: {readOnly: true},
});
const plan = enlace.plan({adapter:'git-status', operation:'status', input:{}});
console.log(await enlace.execute({planId:plan.planId}));
```

The CLI adapter uses host-selected executables and argument builders, no shell, bounded output and a minimal environment. A trusted local interface can declare `requiresResearch:false`; this is an explicit host decision, not automatic endpoint discovery. See [the adapter contract](docs/core-contract.md).

For a host plugin with writes, declare `effect:'write'` and supply `authorize(plan, {signal})` to the SDK. Authorization must return `true` for the exact immutable plan. Omitted or refused authorization denies the write; model arguments cannot provide it. The core is an application policy layer, not a security boundary against malicious host code. The generic HTTP adapter is GET-only.

For CLI/MCP custom runtimes, explicitly pass `--config ./host-config.mjs`. That trusted module exports `createRuntime({network})` returning an Enlace runtime. Loading this file executes host code. Never source it from a model/tool argument or an unreviewed downloaded configuration. [Example](examples/host-config.mjs).

## Limits and development

- Public network by default; every DNS answer is checked and the selected address is pinned. HTTPS certificates are verified. No credentials, cookies, custom auth headers or redirects in HTTP built-ins.
- HTTP: 10 seconds, 128 KiB JSON / 512 KiB source body / 12 KiB extracted text. CLI: 10 seconds, combined stdout/stderr 128 KiB. Core input: 32 KiB; output: 128 KiB.
- No automatic login, provider switching, arbitrary MCP connection, browser profiles or native GUI control.
- External text remains untrusted. Markers and schemas do not solve semantic prompt injection; the host must enforce task authorization and review sources.
- CLI subprocesses are not an OS sandbox. POSIX process groups are terminated on timeout/cancel; Windows only guarantees termination of the direct child.

```sh
npm run check
npm test
npm pack --dry-run
```

CI is configured for Node.js 22/24 on Linux, macOS and Windows. Local verification is reported in [CHANGELOG.md](CHANGELOG.md); a configured matrix alone is not proof of cross-platform success.

## Related work

[OpenCLI](https://github.com/jackwener/OpenCLI) develops web adapters and browser-driven CLIs; [UFO](https://github.com/microsoft/UFO) combines desktop APIs and GUI actions; [Composio](https://docs.composio.dev/) offers managed app integrations and authentication. Enlace does not claim to replace their coverage. Its focus is a small reusable connection lifecycle with explicit evidence, policy and execution boundaries.

## License

MIT for this project's code. Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). No third-party runtime, browser or vendor source is bundled.
