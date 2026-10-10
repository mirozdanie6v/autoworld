import {cp, mkdir, rm, copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, {recursive:true, force:true});
await mkdir(dist, {recursive:true});
await copyFile(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'public'), dist, {recursive:true});
await copyFile(path.join(root, 'shared', 'auto-sale-manager-directory.mjs'), path.join(dist, 'auto-sale-manager-directory.mjs'));
await copyFile(path.join(root, 'shared', 'auto-sale-notification-links.mjs'), path.join(dist, 'auto-sale-notification-links.mjs'));
console.log('Built isolated AutoWorld static application');
