import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = ['index.html', 'senseos.js', 'platform.js', 'platform-loader.js', 'business-preload.js', 'business.js', 'sw.js'];
const forbidden = [
  'Temporary administrator',
  'sense.demoAdminUntil',
  'local-demo-admin',
  'Backend not connected',
  '_company/company.part-'
];

for (const file of files) {
  const source = await readFile(resolve(root, file), 'utf8');
  for (const term of forbidden) {
    if (source.includes(term)) throw new Error(`${file} contains removed development path: ${term}`);
  }
}
