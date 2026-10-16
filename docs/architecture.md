# Architecture

```text
SDK host / CLI / JSON Lines / MCP
                 |
          common Enlace core
                 |
   registry -> research -> plan -> execute
                 |
      trusted application adapters
      HTTP JSON / static HTTP / CLI
```

The host constructs a runtime with trusted adapters and policy. Transport requests supply JSON operation data, never executable modules or authorization callbacks. The registry snapshots schemas and metadata and uses Ajv to validate data without coercion or defaults.

Research reads explicit sources through a host reader, retains hashes, excerpts and rationale, and caches evidence for an exact target URL, operation, adapter version and schema. It records what was read; it does not determine official status or semantic truth. Search belongs to the calling agent or a separately registered trusted service.

Planning filters policy, valid input and research eligibility before ordering routes by declared relative cost. Plans are immutable server-side records, not executable client receipts. Execution consumes a plan before awaiting authorization or an adapter. Writes require the host callback; all operations are one-use with no automatic retries or backend fallback.

Adapters can represent an API, CLI, existing MCP service or UI driver, but only the adapters actually registered appear as capabilities. The first distribution supplies HTTP readers and a configurable CLI adapter. Third-party MCP forwarding, browser UI, desktop accessibility and OAuth are not implemented by this package. They should be added behind the same contract, with effect declarations, auth custody, cancellation and bounded I/O.

The default distribution has no language model, model-specific prompt loop, resident browser, provider account manager, discovery daemon or cloud service. It does not scan personal app configurations. A capability declaration is not a live health check.

The public package and the original Pi/Warp integration have separate installations. Publishing this SDK does not overwrite existing launchers, credentials or presets.
