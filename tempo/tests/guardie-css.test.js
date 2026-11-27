import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const css = read('style.css');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const cssLive = noComments(css);
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

test('nessun font-size sotto i 12px', () => {
  const bad = [];
  for (const m of cssLive.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    for (const n of m[1].matchAll(/(\d*\.?\d+)px/g)) if (parseFloat(n[1]) < 12) bad.push(`riga ${lineOf(cssLive, m.index)}: font-size: ${m[1].trim()}`);
  }
  assert.deepEqual(bad, []);
});

test('ogni z-index usa un token --z-… (o auto)', () => {
  const bad = [];
  for (const m of cssLive.matchAll(/z-index\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    if (v !== 'auto' && (!/var\(--z-/.test(v) || /(^|[\s(,])-?\d/.test(v.replace(/var\([^)]*\)/g, '')))) bad.push(`riga ${lineOf(cssLive, m.index)}: z-index: ${v}`);
  }
  assert.deepEqual(bad, []);
});

test('i token --z-… usati sono definiti', () => {
  const defined = new Set([...cssLive.matchAll(/(--z-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...cssLive.matchAll(/z-index\s*:\s*var\((--z-[a-z0-9-]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((u) => !defined.has(u)), []);
});

test('esiste un blocco prefers-reduced-motion', () => {
  assert.match(cssLive, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('ogni file di js/ è nella SHELL del service worker', () => {
  const sw = read('sw.js');
  const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
  const listed = new Set([...shell.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const files = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);
  assert.ok(files.length > 5);
  assert.deepEqual(files.filter((f) => !listed.has(f)), []);
});

test('VERSION del service worker ha la forma tempo-vN', () => {
  assert.match(read('sw.js'), /const VERSION = 'tempo-v\d+'/);
});

test('la CSP c\'è e non permette eval negli script', () => {
  const html = read('index.html');
  const tag = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
  assert.ok(tag, 'meta CSP mancante');
  const script = tag[1].split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
  assert.ok(script, 'manca script-src');
  assert.ok(!/'unsafe-eval'/.test(script), script);
  assert.ok(!/'unsafe-inline'/.test(script), script);
  assert.match(tag[1], /object-src 'none'/);
});
