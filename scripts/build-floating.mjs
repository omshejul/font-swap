import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function buildFloating(destination='dist/floating-extension') {
  await mkdir(path.dirname(destination),{recursive:true});
  await rm(destination,{recursive:true,force:true});
  await cp('extension',destination,{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(destination,'manifest.json')));
  manifest.name='SwapFont Floating';
  manifest.action.default_title='Open SwapFont Floating';
  manifest.permissions=manifest.permissions.filter(permission=>permission!=='sidePanel');
  delete manifest.side_panel;
  await writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return path.resolve(destination);
}
if (process.argv[1]===fileURLToPath(import.meta.url)) console.log(await buildFloating());
