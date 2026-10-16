import { requestBounded } from './network.mjs';

export function createHttpJsonAdapter(options = {}) {
  return {
    id: 'http-json', version: '0.1.0', kind: 'api',
    limits: { timeoutMs: 10000, responseBytes: 131072, authentication: false, redirects: false, retries: false },
    capabilities: [{ id: 'request', effect: 'read', requiresResearch: true, cost: 1, inputSchema: {
      type: 'object', properties: { url: { type: 'string' }, method: { type: 'string', enum: ['GET'], default: 'GET' } }, required: ['url'], additionalProperties: false,
    } }],
    async execute(operation, input, { signal } = {}) {
      if (operation !== 'request' || !input || Object.keys(input).some(key => !['url', 'method'].includes(key)) || (input.method ?? 'GET') !== 'GET') throw new Error('Only the request operation with GET is supported');
      const result = await requestBounded(input.url, { ...options, maxBytes: 131072, accept: 'application/json', signal });
      const { body, ...metadata } = result;
      if (!result.ok) return { ...metadata, data: null };
      if (body && !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(result.headers['content-type'])) throw new Error('Expected a JSON response');
      return { ...metadata, data: body ? JSON.parse(body) : null };
    },
  };
}
