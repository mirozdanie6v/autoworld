import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

async function collect(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  const files=[];
  for(const entry of entries){
    const path=join(dir,entry.name);
    if(entry.isDirectory())files.push(...await collect(path));
    else if(entry.isFile()&&entry.name.endsWith('.mjs'))files.push(path);
  }
  return files;
}

const files=(await collect('public')).sort();
if(!files.length)throw new Error('no_public_browser_modules_found');

for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
}
console.log(`Browser syntax OK: ${files.length} modules`);
