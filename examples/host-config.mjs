import {createDefaultEnlace} from '../src/index.mjs';
import {createGitStatusAdapter} from './custom-adapter.mjs';

// Explicit trusted startup code, never loaded through an MCP/tool argument.
export function createRuntime({network}) {
  return createDefaultEnlace({network,adapters:[createGitStatusAdapter(process.cwd())],policy:{readOnly:true}});
}
