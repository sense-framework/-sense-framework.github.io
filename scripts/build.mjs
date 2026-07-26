import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
const assets = [
  'index.html',
  'config.js',
  'senseos.css',
  'senseos.js',
  'platform.css',
  'platform.js',
  'platform-loader.js',
  'business-preload.js',
  'enterprise.css',
  'business.js',
  'romeo.js',
  'icon.svg',
  'manifest.webmanifest',
  'sw.js'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of assets) await cp(resolve(root, asset), resolve(output, asset));

const index = await readFile(resolve(output, 'index.html'), 'utf8');
const loader = await readFile(resolve(output, 'platform-loader.js'), 'utf8');
const entryGraph = `${index}\n${loader}`;
for (const asset of assets.filter(name => !['index.html', 'config.js', 'sw.js'].includes(name))) {
  if (!entryGraph.includes(asset) && !['icon.svg', 'manifest.webmanifest'].includes(asset)) {
    throw new Error(`Production index does not reference ${asset}`);
  }
}
