import {spawn} from 'node:child_process';

const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 10_000;

/** Configuration and argument builders are trusted host code, never agent input.
 * This is bounded process execution, not an operating-system sandbox.
 * Write authorization belongs to the core router before execute is called.
 */
export function createCliAdapter({id,version='1.0.0',command,operations,cwd,env={}}) {
  if(typeof id!=='string'||!id||typeof command!=='string'||!command||command.includes('\0'))throw new Error('Invalid CLI adapter configuration');
  if(!Array.isArray(operations)||!operations.length)throw new Error('CLI operations are required');
  const configured=new Map();
  for(const operation of operations){
    if(!operation||typeof operation.id!=='string'||!operation.id||configured.has(operation.id)||typeof operation.argv!=='function'||!['read','write'].includes(operation.effect)||operation.stdin!==undefined&&typeof operation.stdin!=='function')throw new Error('Invalid CLI operation');
    configured.set(operation.id,{...operation});
  }
  const processEnv={PATH:process.env.PATH??'',LANG:'C.UTF-8',...(process.platform==='win32'&&process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...env};
  const exposed=[...configured.values()].map(({argv,stdin,...metadata})=>Object.freeze({...metadata,requiresResearch:metadata.requiresResearch??false,cost:metadata.cost??3}));
  return Object.freeze({id,version,kind:'cli',capabilities:Object.freeze(exposed),async execute(operation,input,{signal}={}){
    signal?.throwIfAborted();
    const spec=configured.get(typeof operation==='string'?operation:operation?.id);
    if(!spec)throw new Error('Unknown CLI operation');
    let args,stdin;
    try{args=spec.argv(input);stdin=spec.stdin?.(input);}catch{throw new Error('CLI arguments rejected');}
    if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.includes('\0'))||args.reduce((n,arg)=>n+Buffer.byteLength(arg),0)>MAX_BYTES||stdin!==undefined&&(typeof stdin!=='string'||Buffer.byteLength(stdin)>MAX_BYTES))throw new Error('CLI arguments rejected');
    return run(command,args,{cwd,env:processEnv,stdin,signal});
  }});
}

function run(command,args,{cwd,env,stdin,signal}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,shell:false,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
    let bytes=0,failure,forceTimer,settled=false;
    const chunks=[];
    const kill=name=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,name);else child.kill(name);}catch{/* Already exited. */}};
    const stop=message=>{if(failure)return;failure=new Error(message);kill('SIGTERM');forceTimer=setTimeout(()=>kill('SIGKILL'),100);};
    const abort=()=>stop('CLI request cancelled');
    const timer=setTimeout(()=>stop('CLI execution exceeded 10 seconds'),TIMEOUT_MS);
    signal?.addEventListener('abort',abort,{once:true});
    const cleanup=()=>{clearTimeout(timer);clearTimeout(forceTimer);signal?.removeEventListener('abort',abort);};
    const finish=(error,value)=>{if(settled)return;settled=true;cleanup();if(failure)kill('SIGKILL');error?reject(error):resolve(value);};
    const consume=(chunk,retain)=>{bytes+=chunk.length;if(bytes>MAX_BYTES){stop('CLI output exceeded 128 KiB');return;}if(retain)chunks.push(chunk);};
    child.stdout.on('data',chunk=>consume(chunk,true));
    child.stderr.on('data',chunk=>consume(chunk,false));
    child.stdin.on('error',()=>{});
    child.on('error',()=>finish(new Error('CLI process could not be started')));
    child.on('close',code=>{
      if(failure)return finish(failure);
      if(code!==0)return finish(new Error('CLI process failed; diagnostics withheld'));
      const text=Buffer.concat(chunks).toString('utf8');
      try{finish(null,{ok:true,format:'json',data:JSON.parse(text)});}
      catch{finish(null,{ok:true,format:'text',data:text});}
    });
    child.stdin.end(stdin??'');
    if(signal?.aborted)abort();
  });
}
