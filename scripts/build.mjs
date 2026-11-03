// Copies only the static site into dist/, so server source never ships as a public asset.
import { cp, rm, mkdir } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await cp('index.html', 'dist/index.html');
await cp('assets', 'dist/assets', { recursive: true });
console.log('Built dist/ (index.html + assets)');
