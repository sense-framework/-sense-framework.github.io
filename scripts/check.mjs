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

const html = await readFile(resolve(root, 'index.html'), 'utf8');
if (!html.includes('Content-Security-Policy')) throw new Error('index.html must define a Content Security Policy');
if (!html.includes("object-src 'none'")) throw new Error('CSP must block object embeds');

const platform = await readFile(resolve(root, 'platform.js'), 'utf8');
if (!platform.includes("credentials: 'include'")) throw new Error('API requests must include the hardened session cookie');
if (platform.includes('headers.authorization') || platform.includes('Bearer ${state.')) {
  throw new Error('Browser bearer-token storage is forbidden');
}

for (const file of ['senseos.js', 'business-preload.js', 'business.js', 'romeo.js']) {
  const source = await readFile(resolve(root, file), 'utf8');
  if (source.includes('localStorage.setItem(') || source.includes('localStorage.getItem(')) {
    throw new Error(`${file} must not persist account data across browser sessions`);
  }
}
