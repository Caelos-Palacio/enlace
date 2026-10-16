export {createEnlace} from './core/router.mjs';
export {createHttpJsonAdapter} from './adapters/http-json.mjs';
export {createHttpStaticAdapter, readSource} from './adapters/http-static.mjs';
export {createCliAdapter} from './adapters/cli.mjs';

import {createEnlace} from './core/router.mjs';
import {createHttpJsonAdapter} from './adapters/http-json.mjs';
import {createHttpStaticAdapter, readSource} from './adapters/http-static.mjs';

/** Default runtime: public HTTP readers, independent of any agent framework. */
export function createDefaultEnlace({network = {}, adapters = [], ...options} = {}) {
  return createEnlace({
    ...options,
    adapters: [createHttpJsonAdapter(network), createHttpStaticAdapter(network), ...adapters],
    readSource: (url, context) => readSource(url, {...network, ...context}),
  });
}
