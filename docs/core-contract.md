# Host contract

`createEnlace` is an in-process library. It does not load discovered modules, spawn commands, read accounts, or choose a model. The host registers trusted adapter code once. Registering arbitrary model-supplied JavaScript would grant that code the host process's permissions.

```js
import { createEnlace } from '../src/core/router.mjs';
const runtime = createEnlace({
  adapters: [trustedAdapter],
  readSource: async (url, { signal }) => ({ ok: true, status: 200, text: 'Actual fetched documentation' }),
  authorize: async (concretePlan, { signal }) => humanApproval(concretePlan),
  policy: { readOnly: false, allowTarget: (url, adapter, operation) => allowed(url) },
});
```

`readSource` must really read its URL. `authorize` must be host-controlled and return exactly `true`; tool arguments cannot supply it. Both callbacks should respect cancellation. The core cannot certify honesty or safety of code supplied by its host.

An adapter has `{ id, version, kind, capabilities, execute }`. A capability has `{ id, inputSchema, effect: 'read' | 'write', requiresResearch: boolean, cost: number }`. `execute(operation, input, { signal, plan, policy })` returns bounded JSON. Effect is authoritative adapter metadata: a capability marked `read` must reject modifying methods itself. GET is not guaranteed side-effect-free on arbitrary servers. Input schemas use Ajv without coercion, defaults, or field removal. This core does not validate JSON Schema format annotations; adapters validate URLs and their other domain-specific values.

- `capabilities()` returns a frozen declaration snapshot; it does not probe connectivity.
- `research({adapter, operation, target, sourceUrls, reason}, {signal}?)` reads one or two actual successful sources using `readSource`. It records hashes and an explicit rationale. The target is an exact HTTP(S) URL. Results prove successful reading, not source officiality, semantic relevance, or permission. All sources must succeed. Evidence is in memory, scoped to adapter version/schema, operation, and exact target; it expires within five minutes.
- `plan({operation, input, adapter?})` validates bounded plain JSON, filters host policy, operation/schema, and current research, then selects the lowest-cost eligible route, breaking ties by adapter ID and listing eligible equal-cost alternatives in the plan. An explicit adapter prevents choosing another one. Inputs of research-requiring capabilities must include `url`. The frozen plan includes a random ID, concrete input, target, effect, schema hash, request hash, and expiration.
- `execute({planId}, {signal}?)` accepts only a stored plan ID, checks policy and research again, and consumes the plan before awaiting anything. Writes require a fresh host callback for the concrete plan. Declined, failed, and cancelled calls cannot reuse the plan. Reads are single-use too. There are no retries or fallback routes. A new attempt requires a new plan.
- `clear()` clears plans and evidence, for example when the host changes sessions.

The runtime defaults to at most 256 plans and 256 research entries. Arguments are bounded to 32 KiB, structured results to 128 KiB, and recursive JSON to depth 20 and 10,000 nodes. Execution results carry `untrusted: true` and preserve an adapter's explicit `ok: false` as an unsuccessful wrapper result; this label does not sanitize all possible private information or prevent prompt injection by itself. Policy callbacks, registered adapters, and source readers remain trusted host code. Limits apply to values handled by the core; they are not an OS sandbox, network firewall, or CPU/RAM boundary for an adapter.

The HTTP adapter must implement its own DNS, TLS, streaming, destination, timeout, and authentication policy before returning values. Passing `policy.allowTarget` to a URL validator alone does not prevent DNS rebinding. No account/session capabilities are implicit in research records or plans.
