import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function offlineShell() {
  let assets = [];
  return {
    name: 'complete-offline-shell',
    generateBundle(_options, bundle) { assets = Object.keys(bundle).filter((name) => /\.(js|css|woff2?|svg)$/.test(name)).map((name) => `/${name}`); },
    closeBundle() {
      const shell = ['/', '/manifest.webmanifest', '/icon.svg', ...assets];
      const version = createHash('sha256').update(JSON.stringify(shell)).digest('hex').slice(0, 16);
      const template = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
      writeFileSync(new URL('./dist/sw.js', import.meta.url), template.replace('__VERSION__', version).replace('/* __ASSETS__ */ []', JSON.stringify(shell)));
    },
  };
}
