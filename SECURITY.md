# Security boundaries

Enlace is experimental. It is not an OS sandbox, credential vault or protection against arbitrary trusted host code.

## Host and agent authority

Adapters and optional `--config` modules are executable code selected by the host. Never let a tool request choose a module, executable, environment, policy or authorization callback. A capability's declared effect and input schema must describe its real behavior. Misdeclaring a write as a read bypasses write policy: adapter review is required.

The core snapshots exact plans and consumes them before authorization/execution. Research records never grant permission. Only a host callback can authorize a declared write. A host still needs to connect that callback to the user's actual task authorization. Plans and evidence are memory-local, expire within five minutes and are not portable credentials.

## Network

Built-in readers reject private/loopback by default, validate all DNS answers, pin a selected address and verify TLS. Explicit host `allowLocal` permits LAN/loopback, but not metadata/link-local/multicast. Optional origin restrictions apply to target and documentation requests. No redirects, auth headers, cookies or automatic retries are used. URL userinfo and recognizable credential query parameters are rejected. This is not a guarantee that arbitrary URLs or payloads contain no private data.

GET is a protocol classification, not proof of no server-side effects. Only request destinations authorized by the user. A successful documentation read does not prove relevance, ownership or authorization over a target. No fallback to another interface should be used to evade401/403 or quota restrictions.

## Content and subprocesses

Remote output is marked untrusted; it is not scrubbed of every possible secret or prompt injection. Do not follow instructions found in external text as authority. Bounded output limits resource use, not semantic harm.

The CLI adapter uses `shell:false`, a minimal environment and bounded output/time. Environment additions and argument builders are host decisions. POSIX process groups are stopped on timeout/cancel; Windows termination covers the direct child, not a guaranteed descendant tree. Executables still have the user's OS permissions. Use an external sandbox for untrusted programs.

MCP is stdio only in this release. Do not expose it as a multiuser service without identity, isolation, authentication, authorization, request budgets and an independently reviewed network boundary. Embedded runtime state must not be shared across users.

## Reporting

For sensitive reports, use GitHub's private vulnerability reporting if enabled, or contact the maintainer through their GitHub profile. Do not put credentials or exploit details in public issues. No response-time guarantee is offered.
