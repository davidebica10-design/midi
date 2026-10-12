// L'esecutore del banco di prova: per ogni caso confronta le regole, il modello da solo e la combinazione
// (quella che userebbe l'app), e misura la latenza. Funziona con qualsiasi motore di decide.js.
import { decideByRules, modelScore, combine } from '../../js/decide.js';
import { ALL_CASES, build } from './cases.mjs';

const argmax = (scores, ids) => ids.reduce((best, id) => (scores[id] > scores[best] ? id : best), ids[0]);
export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
export function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
}

/** fetch con nuovi tentativi su 429/503 (i piani gratuiti hanno limiti): la latenza è quella dell'ultimo tentativo. */
export function retrying(fetchImpl, { retries = 3, waitMs = 8000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const f = async (url, init) => {
    let res;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const t0 = performance.now();
      res = await fetchImpl(url, init);
      f.lastMs = performance.now() - t0;
      if (res.status !== 429 && res.status !== 503) return res;
      f.retries++;
      const ra = +res.headers?.get?.('retry-after');
      await sleep((Number.isFinite(ra) && ra > 0 ? ra * 1000 : waitMs) * (attempt + 1));
    }
    return res;
  };
  f.retries = 0;
  f.lastMs = 0;
  return f;
}

/**
 * runBench({ decider, tasks: ['route','scene'], fetchImpl, delayMs, timeoutMs, limit, cases, onCase })
 * Restituisce { rows, summary }.
 */
export async function runBench({ decider, tasks = ['route', 'scene'], fetchImpl = globalThis.fetch, delayMs = 0, timeoutMs = 20000, limit = Infinity, cases = ALL_CASES, onCase, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const f = retrying(fetchImpl, { sleep });
  const rows = [];
  let seen = 0;
  for (const c of cases) {
    if (!tasks.includes(c.task) || seen >= limit) continue;
    const b = build(c);
    if (b.code) { rows.push({ id: c.id, task: c.task, code: true, text: c.text }); continue; }
    seen++;
    const ids = b.options.map((o) => o.id);
    const row = { id: c.id, task: c.task, hard: !!c.hard, gold: c.gold, text: c.text, rules: decideByRules(b.options).id, model: null, blend: null, blendSource: null, ms: null, error: null };
    if (decider && decider.kind !== 'rules') {
      f.retries = 0;
      try {
        const ms = await modelScore({ task: b.task, state: b.state, options: b.options, decider, fetchImpl: f, timeoutMs });
        row.ms = Math.round(f.lastMs);
        row.model = argmax(ms.scores, ids);
        const mixed = combine(b.options, ms, { ...decider, weight: decider.weight, minConfidence: decider.minConfidence });
        row.blend = mixed.id;
        row.blendSource = mixed.source;
        row.confidence = Math.round(mixed.confidence * 100) / 100;
      } catch (e) { row.error = e.message; }
      row.retries = f.retries;
      if (delayMs) await sleep(delayMs);
    }
    rows.push(row);
    onCase?.(row);
  }
  return { rows, summary: summarize(rows, decider) };
}

export function summarize(rows, decider) {
  const out = { decider: decider ? { kind: decider.kind, model: decider.model || null, url: decider.url ? new URL(decider.url).host : null } : null, tasks: {} };
  for (const task of [...new Set(rows.map((r) => r.task))]) {
    const rs = rows.filter((r) => r.task === task);
    const asked = rs.filter((r) => !r.code);
    const ok = asked.filter((r) => !r.error && r.model);
    const hit = (key) => ok.filter((r) => r[key] === r.gold).length;
    const lat = ok.map((r) => r.ms);
    out.tasks[task] = {
      cases: rs.length, byCode: rs.length - asked.length, asked: asked.length,
      rules: { right: asked.filter((r) => r.rules === r.gold).length, of: asked.length, pct: pct(asked.filter((r) => r.rules === r.gold).length, asked.length) },
      ...(decider && decider.kind !== 'rules' ? {
        answered: ok.length, errors: asked.length - ok.length, errorList: [...new Set(asked.filter((r) => r.error).map((r) => r.error))].slice(0, 5),
        rulesSameCases: { right: ok.filter((r) => r.rules === r.gold).length, of: ok.length, pct: pct(ok.filter((r) => r.rules === r.gold).length, ok.length) },
        model: { right: hit('model'), of: ok.length, pct: pct(hit('model'), ok.length) },
        blend: { right: hit('blend'), of: ok.length, pct: pct(hit('blend'), ok.length), usedModel: ok.filter((r) => r.blendSource && r.blendSource !== 'rules').length },
        latencyMs: { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), max: lat.length ? Math.round(Math.max(...lat)) : null, under2500: pct(lat.filter((x) => x <= 2500).length, lat.length) },
        retries: ok.reduce((a, r) => a + (r.retries || 0), 0),
        modelWrong: ok.filter((r) => r.model !== r.gold).map((r) => `${r.id}${r.text ? ` «${r.text}»` : ''}: modello=${r.model}, giusto=${r.gold}`),
      } : {}),
    };
  }
  return out;
}

/** Il riassunto in italiano, per il terminale. */
export function report(summary) {
  const L = [];
  const d = summary.decider;
  L.push(d ? `Motore: ${d.kind}${d.model ? ' · ' + d.model : ''}${d.url ? ' · ' + d.url : ''}` : 'Solo regole (nessun modello)');
  for (const [task, t] of Object.entries(summary.tasks)) {
    L.push('', `== ${task === 'route' ? 'Che modello serve a un messaggio' : 'Quale obiettivo dà il tono alla schermata'} ==`);
    L.push(`casi ${t.cases}: ${t.byCode} li fa il codice da solo, ${t.asked} sono vere scelte`);
    L.push(`regole da sole:        ${t.rules.right}/${t.rules.of} (${t.rules.pct}%)`);
    if (t.model) {
      L.push(`modello (risposte ${t.answered}/${t.asked}, errori ${t.errors}${t.errorList?.length ? ': ' + t.errorList.join(' | ') : ''})`);
      L.push(`  regole sugli stessi: ${t.rulesSameCases.right}/${t.rulesSameCases.of} (${t.rulesSameCases.pct}%)`);
      L.push(`  modello da solo:     ${t.model.right}/${t.model.of} (${t.model.pct}%)`);
      L.push(`  combinazione (app):  ${t.blend.right}/${t.blend.of} (${t.blend.pct}%), il modello decide in ${t.blend.usedModel} casi`);
      L.push(`  latenza: p50 ${t.latencyMs.p50} ms · p95 ${t.latencyMs.p95} ms · max ${t.latencyMs.max} ms · entro 2,5 s: ${t.latencyMs.under2500}%${t.retries ? ` · nuovi tentativi per limiti del servizio: ${t.retries}` : ''}`);
      if (t.modelWrong.length) L.push('  il modello sbaglia:', ...t.modelWrong.slice(0, 12).map((x) => '    - ' + x));
    }
  }
  return L.join('\n');
}
