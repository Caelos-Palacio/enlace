import Ajv from 'ajv';
import { failure, snapshot, hash } from './policy.mjs';

export function createRegistry(adapters = []) {
  if (!Array.isArray(adapters)) throw failure('INVALID_ADAPTER', 'Adapters must be an array');
  const entries = new Map();
  const ajv = new Ajv({
    strict: false,
    allErrors: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    validateFormats: false,
  });

  for (const adapter of adapters) {
    if (
      !adapter || typeof adapter.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(adapter.id) || entries.has(adapter.id) ||
      typeof adapter.version !== 'string' || typeof adapter.kind !== 'string' ||
      typeof adapter.execute !== 'function' || !Array.isArray(adapter.capabilities) ||
      !adapter.capabilities.length
    ) {
      throw failure('INVALID_ADAPTER', 'Invalid or duplicate trusted adapter');
    }

    const seen = new Set();
    const capabilities = adapter.capabilities.map(capability => {
      if (
        !capability || typeof capability.id !== 'string' || !capability.id ||
        seen.has(capability.id) || !['read', 'write'].includes(capability.effect) ||
        typeof capability.requiresResearch !== 'boolean' ||
        !Number.isFinite(capability.cost) || capability.cost < 0
      ) {
        throw failure('INVALID_ADAPTER', 'Invalid adapter capability');
      }
      seen.add(capability.id);
      const inputSchema = snapshot(capability.inputSchema);
      let validate;
      try {
        validate = ajv.compile(inputSchema);
      } catch {
        throw failure('INVALID_SCHEMA', 'Invalid adapter input schema');
      }
      const declaration = snapshot({
        id: capability.id,
        inputSchema,
        effect: capability.effect,
        requiresResearch: capability.requiresResearch,
        cost: capability.cost,
      });
      return {
        declaration,
        schemaHash: hash({ adapter: adapter.id, version: adapter.version, ...declaration }),
        validate,
      };
    });

    entries.set(adapter.id, {
      id: adapter.id,
      version: adapter.version,
      kind: adapter.kind,
      capabilities,
      execute: adapter.execute.bind(adapter),
    });
  }

  return {
    entries,
    describe: () => ({
      adapters: [...entries.values()].map(adapter => ({
        id: adapter.id,
        version: adapter.version,
        kind: adapter.kind,
        capabilities: adapter.capabilities.map(capability => ({
          ...capability.declaration,
          schemaHash: capability.schemaHash,
        })),
      })),
    }),
  };
}
