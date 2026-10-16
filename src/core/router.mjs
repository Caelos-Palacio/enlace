import { randomUUID } from 'node:crypto';
import { createRegistry } from './registry.mjs';
import { createResearchLedger, sourceEvidence, sourceObservation } from './research.mjs';
import { failure, fields, snapshot, hash, targetUrl, checkPolicy } from './policy.mjs';

export function createEnlace({
  adapters = [],
  authorize,
  readSource,
  clock = Date.now,
  policy = {},
  ttlMs = 300000,
  maxPlans = 256,
} = {}) {
  if (
    !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 300000 ||
    !Number.isInteger(maxPlans) || maxPlans < 1 || maxPlans > 10000
  ) {
    throw failure('INVALID_CONFIG', 'Invalid bounded runtime limits');
  }

  const registry = createRegistry(adapters);
  const ledger = createResearchLedger({ clock, ttlMs });
  const plans = new Map();
  let generation = 0;
  const runtimePolicy = Object.freeze({ ...policy });

  function resolve(id, operation) {
    const adapter = registry.entries.get(id);
    const cap = adapter?.capabilities.find(item => item.declaration.id === operation);
    if (!cap) throw failure('UNKNOWN_OPERATION', 'Unknown adapter operation');
    return { adapter, cap };
  }

  function hasResearch(adapter, cap, target) {
    return !cap.declaration.requiresResearch ||
      Boolean(ledger.get(adapter.id, cap.declaration.id, cap.schemaHash, target));
  }

  function checkResearch(adapter, cap, target) {
    if (!hasResearch(adapter, cap, target)) {
      throw failure('RESEARCH_REQUIRED', 'Research this exact adapter, operation and target first');
    }
  }

  return {
    capabilities() {
      return snapshot(registry.describe(), 131072);
    },

    async research(input, { signal } = {}) {
      const keys = ['adapter', 'operation', 'target', 'sourceUrls', 'reason'];
      fields(input, keys, keys);
      input = snapshot(input);
      const researchGeneration = generation;
      signal?.throwIfAborted();
      const { adapter, cap } = resolve(input.adapter, input.operation);
      const target = targetUrl(input.target);
      checkPolicy(runtimePolicy, adapter, cap.declaration, { url: target });

      if (
        typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 ||
        !Array.isArray(input.sourceUrls) || input.sourceUrls.length < 1 || input.sourceUrls.length > 2
      ) {
        throw failure('INVALID_INPUT', 'Research needs 1–2 sources and a rationale');
      }
      if (typeof readSource !== 'function') {
        throw failure('RESEARCH_UNAVAILABLE', 'Host must provide a source reader');
      }

      const sources = [];
      const observations = [];
      for (const source of input.sourceUrls) {
        signal?.throwIfAborted();
        const url = targetUrl(source);
        if (runtimePolicy.allowTarget && !runtimePolicy.allowTarget(url, 'research', 'readSource')) {
          throw failure('POLICY_DENIED', 'Research source is disabled by host policy');
        }
        const result = await readSource(url, { signal });
        signal?.throwIfAborted();
        sources.push(sourceEvidence(url, result));
        observations.push(sourceObservation(url, result));
      }
      signal?.throwIfAborted();

      if (researchGeneration !== generation) {
        throw failure('SESSION_CHANGED', 'Runtime cleared during research');
      }
      const receipt = ledger.record({
        adapter: adapter.id,
        operation: cap.declaration.id,
        schemaHash: cap.schemaHash,
        target,
        sources,
        reason: input.reason.trim(),
      });
      return snapshot({ state: 'researched', untrusted: true, receipt, observations }, 131072);
    },

    plan(input) {
      fields(input, ['adapter', 'operation', 'input'], ['operation', 'input']);
      if (typeof input.operation !== 'string') {
        throw failure('INVALID_INPUT', 'Operation must be a string');
      }
      const args = snapshot(input.input);
      const target = args?.url === undefined ? null : targetUrl(args.url);
      const candidates = [];

      for (const adapter of registry.entries.values()) {
        if (input.adapter !== undefined && adapter.id !== input.adapter) continue;
        for (const cap of adapter.capabilities) {
          if (cap.declaration.id !== input.operation) continue;
          try {
            checkPolicy(runtimePolicy, adapter, cap.declaration, args);
            if (cap.validate(args)) candidates.push({ adapter, cap });
          } catch (error) {
            if (error.code !== 'POLICY_DENIED') throw error;
          }
        }
      }
      if (!candidates.length) {
        throw failure('NO_ROUTE', 'No permitted adapter validates this operation input');
      }
      candidates.sort((left, right) =>
        left.cap.declaration.cost - right.cap.declaration.cost ||
        left.adapter.id.localeCompare(right.adapter.id));
      const eligible = candidates.filter(({ adapter, cap }) => hasResearch(adapter, cap, target));
      if (!eligible.length) {
        throw failure('RESEARCH_REQUIRED', 'Research a permitted adapter for this exact operation and target first');
      }
      const { adapter, cap } = eligible[0];
      const alternatives = eligible
        .filter(candidate => candidate.cap.declaration.cost === cap.declaration.cost && candidate.adapter.id !== adapter.id)
        .map(candidate => ({
          adapter: candidate.adapter.id,
          operation: candidate.cap.declaration.id,
          cost: candidate.cap.declaration.cost,
        }));

      if (plans.size >= maxPlans) plans.delete(plans.keys().next().value);
      const plan = snapshot({
        planId: randomUUID(),
        adapter: adapter.id,
        version: adapter.version,
        operation: cap.declaration.id,
        schemaHash: cap.schemaHash,
        effect: cap.declaration.effect,
        input: args,
        target,
        alternatives,
        expiresAt: clock() + ttlMs,
      }, 65536);
      const stored = snapshot({ ...plan, requestHash: hash(plan) }, 65536);
      plans.set(plan.planId, stored);
      return stored;
    },

    async execute(input, { signal } = {}) {
      fields(input, ['planId'], ['planId']);
      signal?.throwIfAborted();
      const executionGeneration = generation;
      const plan = plans.get(input.planId);
      if (!plan) throw failure('UNKNOWN_PLAN', 'Plan is unknown or already consumed');
      // Consume before any await: concurrent calls and denied writes cannot reuse this plan.
      plans.delete(input.planId);
      if (plan.expiresAt <= clock()) throw failure('PLAN_EXPIRED', 'Plan has expired');

      const { adapter, cap } = resolve(plan.adapter, plan.operation);
      if (cap.schemaHash !== plan.schemaHash) {
        throw failure('SCHEMA_CHANGED', 'Adapter schema changed');
      }
      checkPolicy(runtimePolicy, adapter, cap.declaration, plan.input);
      checkResearch(adapter, cap, plan.target);

      if (plan.effect === 'write') {
        if (typeof authorize !== 'function' || await authorize(plan, { signal }) !== true) {
          throw failure('AUTHORIZATION_DENIED', 'Host authorization is required for this exact write plan');
        }
        signal?.throwIfAborted();
        if (executionGeneration !== generation) {
          throw failure('SESSION_CHANGED', 'Runtime cleared during authorization');
        }
        if (plan.expiresAt <= clock()) {
          throw failure('PLAN_EXPIRED', 'Plan expired during authorization');
        }
        checkResearch(adapter, cap, plan.target);
        checkPolicy(runtimePolicy, adapter, cap.declaration, plan.input);
      }

      signal?.throwIfAborted();
      const data = await adapter.execute(plan.operation, plan.input, {
        signal,
        plan,
        policy: runtimePolicy,
      });
      signal?.throwIfAborted();
      if (executionGeneration !== generation) {
        throw failure('SESSION_CHANGED', 'Runtime cleared during execution');
      }
      return snapshot({
        ok: data?.ok !== false,
        untrusted: true,
        adapter: adapter.id,
        operation: plan.operation,
        data,
      }, 131072);
    },

    clear() {
      generation++;
      plans.clear();
      ledger.clear();
    },
  };
}
