import test from 'node:test';
import assert from 'node:assert/strict';
import {createCliAdapter} from '../src/adapters/cli.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function adapter(code,extra={}){
  return createCliAdapter({id:'fixture',command:process.execPath,operations:[{id:'run',effect:'read',inputSchema:{type:'object'},argv:()=>['-e',code]}],...extra});
}
test('CLI parses JSON and does not inherit secrets or HOME',async()=>{
  const previous=process.env.ENLACE_TEST_SECRET;
  process.env.ENLACE_TEST_SECRET='not-for-child';
  try{
    const result=await adapter('console.log(JSON.stringify({secret:process.env.ENLACE_TEST_SECRET??null,home:process.env.HOME??null,lang:process.env.LANG}))').execute('run',{});
    assert.deepEqual(result,{ok:true,format:'json',data:{secret:null,home:null,lang:'C.UTF-8'}});
  }finally{if(previous===undefined)delete process.env.ENLACE_TEST_SECRET;else process.env.ENLACE_TEST_SECRET=previous;}
});
test('CLI keeps arguments literal and returns text',async()=>{
  const cli=createCliAdapter({id:'literal',command:process.execPath,operations:[{id:'run',effect:'read',argv:input=>['-e','process.stdout.write(process.argv[1])',input.text]}]});
  assert.equal((await cli.execute('run',{text:'$(touch arbitrary); echo hello'})).data,'$(touch arbitrary); echo hello');
  await assert.rejects(cli.execute('missing',{}),/Unknown/);
});
test('CLI bounds stdout and stderr together',async()=>{
  await assert.rejects(adapter('process.stdout.write("a".repeat(70000));process.stderr.write("b".repeat(70000))').execute('run',{}),/128 KiB/);
});
test('CLI withholds diagnostics on failure',async()=>{
  await assert.rejects(adapter('process.stderr.write("private diagnostic");process.exit(2)').execute('run',{}),error=>!error.message.includes('private diagnostic')&&error.message.includes('withheld'));
});
test('CLI cancels a running process and rejects aborted requests',async()=>{
  const controller=new AbortController();
  const pending=adapter('setInterval(()=>{},1000)').execute('run',{}, {signal:controller.signal});
  setTimeout(()=>controller.abort(),50);
  await assert.rejects(pending,/cancelled/);
  await assert.rejects(adapter('console.log(1)').execute('run',{}, {signal:controller.signal}));
});
test('CLI rejects unbounded argument/stdin data and spawn errors',async()=>{
  const cli=createCliAdapter({id:'bounded',command:process.execPath,operations:[{id:'run',effect:'read',argv:()=>['-e',''],stdin:()=> 'x'.repeat(128*1024+1)}]});
  await assert.rejects(cli.execute('run',{}),/arguments rejected/);
  await assert.rejects(adapter('',{command:'/definitely-missing-enlace-cli'}).execute('run',{}),/could not be started/);
});
test('POSIX cancellation stops descendants in the process group',{skip:process.platform==='win32'},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enlace-cli-test-'));
  const marker=join(directory,'pid');
  const controller=new AbortController();
  let descendant;
  try{
    const code=`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));setInterval(()=>{},1000);`;
    const pending=adapter(code).execute('run',{}, {signal:controller.signal});
    for(let attempt=0;attempt<100;attempt++){
      try{descendant=Number(await readFile(marker,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}
    }
    assert.ok(descendant,'fixture descendant started');
    controller.abort();
    await assert.rejects(pending,/cancelled/);
    let alive=true;
    for(let attempt=0;attempt<100;attempt++){
      try{
        process.kill(descendant,0);
        // A reaped-later zombie cannot run; the host init owns its cleanup.
        if(process.platform==='linux'&&(await readFile(`/proc/${descendant}/stat`,'utf8')).match(/\) Z /)){alive=false;break;}
      }catch{alive=false;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(alive,false,'descendant no longer executes after cancellation');
  }finally{
    controller.abort();
    if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}
    await rm(directory,{recursive:true,force:true});
  }
});
