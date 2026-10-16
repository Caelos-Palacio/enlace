import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
async function check(dir) {
  for (const file of await readdir(dir, {withFileTypes:true})) {
    const path = `${dir}/${file.name}`;
    if (file.isDirectory()) await check(path);
    else if (file.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], {stdio:'inherit'});
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
for (const dir of ['src','test','examples']) await check(dir);
console.log('JavaScript syntax checks passed.');
