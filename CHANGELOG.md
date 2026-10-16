# Changelog

## 0.1.0

Initial experimental public extraction from a local Pi/Warp integration.

- Independent core registry, schema validation, evidence cache, cost-based plans and one-use execution.
- Exact target/operation/schema research scope, bounded excerpts and host authorization for declared writes.
- Public-network HTTP JSON/static readers and configurable CLI adapter.
- SDK, CLI, JSON Lines and MCP stdio transports sharing the same lifecycle.
- MIT license, dependency notices and CI matrix for Node22/24 on Linux/macOS/Windows.

Local checks: 29 tests passed on Linux with Node22, including real MCP/CLI and HTTP fixtures; syntax checks and npm pack inspection passed. Production dependency audit reported zero known vulnerabilities. Remote CI results must be checked after publication; other operating systems are not claimed verified by local tests.
