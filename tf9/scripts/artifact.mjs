// Packs the production build into one self-contained HTML body for hosting
// as a claude.ai Artifact (the host supplies <html>/<head>/<body>).
// usage: npm run build && node scripts/artifact.mjs [outFile]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dist = 'dist';
const out = process.argv[2] ?? 'dist-artifact/index.html';
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];

const css = [...head.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const js = [...head.matchAll(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
for (const code of js) if (/<\/script/i.test(code)) throw new Error('bundle contains a closing script tag');

const keep = head
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<link rel="stylesheet"[^>]*href="\.\/assets[^>]*>\s*/g, '')
  .replace(/<script type="module"[^>]*src="\.\/assets[^>]*><\/script>\s*/g, '')
  .trim();

const page = `${keep}\n<style>\n${css.join('\n')}\n</style>\n${body.trim()}\n<script type="module">\n${js.join('\n')}\n</script>\n`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
