#!/usr/bin/env node
// Misura un motore decisionale su decisioni vere di Tempo.
//
//   GEMINI_API_KEY=… node tests/bench/bench-decider.mjs --kind llm   --preset gemini
//   GEMINI_API_KEY=… node tests/bench/bench-decider.mjs --kind embed --preset gemini
//   NVIDIA_API_KEY=… node tests/bench/bench-decider.mjs --kind llm   --preset nvidia
//   CLM_API_KEY=…    node tests/bench/bench-decider.mjs --kind clm   --url https://il-tuo-clm
//   node tests/bench/bench-decider.mjs --kind rules          (solo le regole, senza chiavi)
//
// Opzioni: --model NOME · --tasks route,scene · --limit N · --delay MS (pausa tra le chiamate; di partenza 4500 per
// Gemini, per rispettare i limiti del piano gratuito) · --timeout MS · --weight 0.6 · --out FILE.json
// La chiave si legge solo dall'ambiente: non va scritta nei comandi né salvata.
import { writeFileSync, mkdirSync } from 'node:fs';
import { DECIDERS } from '../../js/decide.js';
import { runBench, report } from './run.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const kind = args.kind || 'rules';
const preset = args.preset;
const def = DECIDERS[kind];
if (!def) { console.error('--kind deve essere: ' + Object.keys(DECIDERS).join(', ')); process.exit(2); }
const pr = def.presets?.[preset] || {};
const envKey = { gemini: 'GEMINI_API_KEY', nvidia: 'NVIDIA_API_KEY' }[preset] || (kind === 'clm' ? 'CLM_API_KEY' : null);
const decider = kind === 'rules' ? { kind: 'rules' } : {
  kind, url: args.url || pr.url, model: args.model || pr.model, key: (envKey && process.env[envKey]) || '',
  weight: args.weight != null ? +args.weight : undefined, minConfidence: 0.35,
};
if (kind !== 'rules') {
  if (!decider.url) { console.error('Manca l\'indirizzo: usa --preset gemini|nvidia oppure --url https://…'); process.exit(2); }
  if (!decider.key && preset) { console.error(`Manca la chiave: imposta la variabile d'ambiente ${envKey}.`); process.exit(2); }
}
const delayMs = args.delay != null ? +args.delay : preset === 'gemini' ? 4500 : 0;
const tasks = String(args.tasks || 'route,scene').split(',');
const t0 = Date.now();
const { rows, summary } = await runBench({
  decider, tasks, delayMs, timeoutMs: +args.timeout || 20000, limit: args.limit ? +args.limit : Infinity,
  onCase: (r) => process.stderr.write(r.error ? '✗' : r.model ? (r.model === r.gold ? '·' : 'x') : '·'),
});
process.stderr.write('\n');
console.log(report(summary));
console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s · le etichette sono un mio giudizio: vedi tests/bench/cases.mjs)`);
const out = args.out || new URL(`./out/${kind}-${(decider.model || preset || 'regole').replace(/[^\w.-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url).pathname;
mkdirSync(new URL('./out/', import.meta.url).pathname, { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
console.log('Dettaglio salvato in ' + out);
