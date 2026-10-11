// Il ponte con l'app nativa (Capacitor, cartella native/ del repository).
// Sul web non fa niente. Dentro l'app per iPhone e Mac passa al codice Swift (plugin TempoBridge):
//  - lo «snapshot» (cosa fare adesso, le prossime cose): lo leggono widget, schermata di blocco, Siri e CarPlay;
//  - la scena (colori) per tingere i widget come l'app;
//  - il focus in corso: diventa una Live Activity (isola dinamica e schermata di blocco);
//  - al massimo 2 promemoria al giorno (notifiche locali, senza server);
//  - le richieste che arrivano da Siri / Comandi rapidi («Dì a Tempo…»).

const plugin = () => globalThis.Capacitor?.Plugins?.TempoBridge || null;
export const isNative = () => !!globalThis.Capacitor?.isNativePlatform?.() && !!plugin();
const call = (name, data) => {
  const p = plugin();
  if (!p || typeof p[name] !== 'function' || !isNative()) return Promise.resolve(null);
  return Promise.resolve(p[name](data)).catch((e) => { console.warn('TempoBridge.' + name, e); return null; });
};

let snapTimer = 0, lastSnap = '';
/** Cosa fare adesso e cosa viene dopo (al massimo 5 righe), per widget e Siri. Scrive solo se è cambiato. */
export function snapshot(data) {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const json = JSON.stringify(data);
    if (json === lastSnap) return;
    lastSnap = json;
    call('setSnapshot', { json });
  }, 400);
}

/** Colori e umore della scena (o null): i widget prendono la stessa tinta dell'app. */
export const scene = (sc) => call('setScene', sc ? { palette: sc.palette || [], accent: sc.accent || '', mood: sc.mood, domain: sc.domain, icon: sc.icon } : { palette: [], accent: '', mood: '', domain: '', icon: '' });

/** Parte un timer o un pomodoro: Live Activity con il tempo che resta (endsAt in ms). */
export const focusStarted = ({ title, endsAt, accent, icon, mode }) => call('startActivity', { title, endsAt, accent: accent || '', icon: icon || '', mode });
export const focusUpdated = ({ title, endsAt, paused }) => call('updateActivity', { title, endsAt, paused: !!paused });
export const focusEnded = () => call('endActivity', {});

/** Promemoria locali (sostituiscono quelli di prima): [{ id, at (ms), title, body }], al massimo 2 al giorno. */
export function reminders(list) {
  const byDay = {};
  const keep = [];
  for (const r of list || []) {
    const d = new Date(r.at).toDateString();
    if ((byDay[d] = (byDay[d] || 0) + 1) > 2 || r.at < Date.now()) continue;
    keep.push({ id: String(r.id), at: r.at, title: String(r.title).slice(0, 80), body: String(r.body || '').slice(0, 160) });
  }
  return call('setReminders', { list: keep });
}

/** Richieste da Siri, Comandi rapidi, widget o CarPlay: handler({ kind: 'tell' | 'now' | 'focus', text? }). */
export function onIntent(handler) {
  const p = plugin();
  if (!p || !isNative() || typeof p.addListener !== 'function') return;
  p.addListener('intent', (e) => { try { handler(e || {}); } catch (err) { console.warn(err); } });
  // quelle arrivate mentre l'app era chiusa
  call('pendingIntents', {}).then((r) => { for (const e of r?.list || []) handler(e); });
}

/**
 * Indirizzo e accesso di Tempo Cloud per Siri, widget e CarPlay (o null per toglierli): così rispondono
 * con il piano aggiornato anche quando l'app è chiusa. Restano nel gruppo di app del dispositivo.
 */
export const cloud = (cfg) => call('setCloud', cfg && cfg.url && cfg.token ? { url: cfg.url, token: cfg.token } : { url: '', token: '' });
