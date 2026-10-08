import {mkdir,readFile,rm,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const {version}=JSON.parse(await readFile('extension/manifest.json'));
await mkdir('dist',{recursive:true});const archive=path.resolve(`dist/font-swap-${version}.zip`);
await rm(archive,{force:true});execFileSync('zip',['-q','-r',archive,'.','-x','*.DS_Store'],{cwd:'extension'});
console.log(`${archive} (${(await stat(archive)).size} bytes)`);
