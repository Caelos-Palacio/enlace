import { parse } from 'parse5';
import { requestBounded } from './network.mjs';

const excluded = new Set(['script', 'style', 'noscript', 'template', 'form', 'svg', 'canvas']);
function staticText(body) {
  const fragments = [];
  const pending = [parse(body)];
  while (pending.length) {
    const node = pending.pop();
    if (excluded.has(node.tagName)) continue;
    if (node.nodeName === '#text') fragments.push(node.value);
    else pending.push(...(node.childNodes ?? []).slice().reverse());
  }
  return fragments.join(' ').replace(/\s+/g, ' ').trim();
}
export async function readSource(url, options = {}) {
  const result = await requestBounded(url, { ...options, maxBytes: 524288 });
  const { body, ...metadata } = result;
  if (!result.ok) return { ...metadata, text: '' };
  const type = result.headers['content-type'];
  let text;
  if (/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(type)) {
    if (Buffer.byteLength(body) > 131072) throw new Error('JSON source exceeds 128 KiB');
    text = JSON.stringify(JSON.parse(body));
  } else if (/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type)) text = staticText(body);
  else if (/^text\/plain(?:;|$)/i.test(type)) text = body;
  else throw new Error('Expected an HTML, JSON or plain-text source');
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const bytes = Buffer.from(text);
  const boundedText = new TextDecoder().decode(bytes.subarray(0, 12288), { stream: true });
  return { ...metadata, text: boundedText, truncated: bytes.length > 12288 };
}
export function createHttpStaticAdapter(options = {}) {
  return {
    id: 'http-static', version: '0.1.0', kind: 'http',
    limits: { timeoutMs: 10000, responseBytes: 524288, textBytes: 12288, authentication: false, redirects: false, retries: false },
    capabilities: [{ id: 'readPage', effect: 'read', requiresResearch: true, cost: 2, inputSchema: {
      type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false,
    } }],
    execute(operation, input, { signal } = {}) {
      if (operation !== 'readPage' || !input || Object.keys(input).some(key => key !== 'url')) throw new Error('Only readPage with a URL is supported');
      return readSource(input.url, { ...options, signal });
    },
  };
}
