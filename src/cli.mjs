#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createDefaultEnlace} from './index.mjs';

const HELP = `Enlace — research-first connections for agents

Usage:
  enlace                         Show help; no connections
  enlace capabilities            Inspect registered adapters and schemas
  enlace run --adapter ID --operation OP --input JSON --sources JSON --reason TEXT
  enlace session                 Stateful JSON Lines: capabilities/research/plan/execute
  enlace mcp                     Stateful MCP stdio server

Host options (before or after command):
  --allow-local                  Allow LAN/loopback; metadata remains blocked
  --origin URL                   Allow this origin (repeatable)
  --config FILE                  Explicitly load trusted host code exporting createRuntime

Defaults: public-network read adapters, no credentials, no retries, no browser.
Run state is in memory. Separate CLI processes do not share research or plans.
`;
function parse(args) {
  const options = {origins:[]}; let command;
  for (let i=0; i<args.length; i++) {
    const token = args[i];
    if (token === '--allow-local') options.allowLocal = true;
    else if (token.startsWith('--') && ['--origin','--config','--adapter','--operation','--input','--sources','--reason'].includes(token)) {
      const value=args[++i];
      if (value === undefined) throw new Error(`Missing value for ${token}`);
      if (token === '--origin') options.origins.push(new URL(value).origin);
      else options[token.slice(2)] = value;
    } else if (!command && !token.startsWith('--')) command=token;
    else if (['--help','-h'].includes(token)) command='help';
    else throw new Error(`Unknown option: ${token}`);
  }
  return {command:command ?? 'help',options};
}
async function runtime(options) {
  const network = {allowLocal:options.allowLocal === true,
    ...(options.origins.length ? {origins:options.origins} : {})};
  if (options.config) {
    const module = await import(pathToFileURL(resolve(options.config)).href);
    if (typeof module.createRuntime !== 'function') throw new Error('Trusted config must export createRuntime({network})');
    return module.createRuntime({network});
  }
  return createDefaultEnlace({network,policy:{readOnly:true}});
}
const output = value => process.stdout.write(JSON.stringify(value)+'\n');
const errorResult = error => ({ok:false,code:error.code ?? 'REQUEST_FAILED',message:String(error.message ?? 'Request failed').slice(0,400)});

export async function main(args=process.argv.slice(2)) {
  const {command,options}=parse(args);
  if (command === 'help') {process.stdout.write(HELP);return;}
  if (!['capabilities','run','session','mcp'].includes(command)) throw new Error('Unknown command; use enlace help');
  const enlace=await runtime(options);
  if (command === 'capabilities') {output(enlace.capabilities());return;}
  if (command === 'mcp') {
    const {startMcp}=await import('./transports/mcp.mjs');
    await startMcp({enlace});return;
  }
  if (command === 'run') {
    if (!options.adapter || !options.operation || !options.input) throw new Error('run requires --adapter, --operation and --input');
    const input=JSON.parse(options.input);
    const meta=enlace.capabilities().adapters.find(a=>a.id===options.adapter)?.capabilities.find(c=>c.id===options.operation);
    if (meta?.requiresResearch) await enlace.research({adapter:options.adapter,operation:options.operation,
      target:input.url,sourceUrls:JSON.parse(options.sources ?? '[]'),reason:options.reason ?? ''});
    const plan=enlace.plan({adapter:options.adapter,operation:options.operation,input});
    const result=await enlace.execute({planId:plan.planId});output(result);
    if (result.ok === false) process.exitCode=1;
    return;
  }
  process.stdin.setEncoding('utf8');
  let buffer='';
  for await (const chunk of process.stdin) {
    buffer+=chunk.toString('utf8');
    if (Buffer.byteLength(buffer)>65536) throw new Error('JSON Lines input exceeds 64 KiB');
    let newline;
    while ((newline=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
      if (!line.trim()) continue;
      let request;
      try {
        request=JSON.parse(line);
        if (!request || typeof request!=='object' || Object.keys(request).some(k=>!['id','method','params'].includes(k)) || !['capabilities','research','plan','execute'].includes(request.method)) throw new Error('Invalid session request');
        if (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number') throw new Error('id must be a string or number');
        output({id:request.id ?? null,result:await enlace[request.method](request.params ?? {})});
      } catch (error) {output({id:typeof request?.id==='string'||typeof request?.id==='number'?request.id:null,error:errorResult(error)});}
    }
  }
  if (buffer.trim()) throw new Error('End each JSON Lines request with a newline');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {await main();} catch (error) {process.stderr.write(JSON.stringify(errorResult(error))+'\n');process.exitCode=1;}
}
