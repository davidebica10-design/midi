// Casi etichettati per misurare i motori decisionali su decisioni VERE di Tempo.
// Le etichette («gold») sono il mio giudizio sul comportamento giusto: sono poche e soggettive, quindi la
// misura dice «quanto il motore è d'accordo con questi criteri» e quanto è veloce, non la verità assoluta.
// Chi vuole una misura sua può cambiare i casi: basta tenere la forma.
import { migrate } from '../../js/store.js';
import { planDays, parseHM } from '../../js/scheduler.js';
import { routeOptions, sceneGoalOptions, stateText } from '../../js/decide.js';
import { localParse } from '../../js/parse.js';

export const DAY = '2026-10-12'; // lunedì
const at = (hm) => Date.parse(`${DAY}T${hm}:00`);

// ---------------------------------------------------------------- 1. Che modello serve a un messaggio
// Se il parser di Tempo capisce da solo la frase («ho finito la spesa», «il martedì e il giovedì vado in palestra
// alle 19») la fa il codice, subito e gratis: non c'è niente da scegliere. La scelta per un modello è solo tra
// «veloce» (richiesta normale: aggiungere, spostare, cambiare) e «capace» (richiesta aperta o corposa: organizzare,
// riassumere, ragionare su settimane o mesi), sulle frasi che il codice non gestisce da solo.
export const ROUTE_TASK = 'Che tipo di modello serve per questo messaggio dell\'utente di Tempo: uno veloce (richiesta normale) o uno capace (richiesta aperta o corposa)?';
// 'heavy' = aperta o corposa · 'normal' = tutto il resto
export const ROUTE_CASES = [
  ['normal', 'ho finito la spesa'], ['normal', 'sposta il beat 02 a domani'], ['normal', 'la domenica stacco'], ['normal', 'colora la call di rosa'],
  ['normal', 'elimina la spesa'], ['normal', 'ho fatto metà della relazione'], ['normal', 'la relazione è urgente'], ['normal', 'la spesa può aspettare'],
  ['normal', 'ho finito il mix 02'], ['normal', 'non ho fatto la spesa'], ['normal', 'segna la relazione come fatta'], ['normal', 'rimanda la relazione a giovedì'],
  ['normal', 'domani alle 16 call con Marco'], ['normal', 'giovedì ho il dentista alle 15:30'], ['normal', 'aggiungi la lavatrice 20 minuti'],
  ['normal', 'venerdì devo consegnare la relazione e mi servono ancora 4 ore'], ['normal', 'il martedì e il giovedì vado in palestra alle 19'],
  ['normal', 'oggi sono libero solo dalle 15 alle 19'], ['normal', 'mercoledì non ci sono, sono a Milano tutto il giorno'],
  ['normal', 'la riunione di domani è stata spostata alle 11'], ['normal', 'settimana prossima ho 3 colloqui: lunedì alle 10, mercoledì alle 15 e venerdì alle 11'],
  ['normal', 'mi sveglio alle 7 e vado a dormire a mezzanotte'], ['normal', 'voglio far uscire l\'EP con MIDI entro fine novembre'], ['normal', 'ogni giorno 30 minuti di inglese'],
  ['normal', 'metti la registrazione voce dopo il beat'], ['normal', 'preparare la cena dopo la palestra, 40 minuti'],
  ['heavy', 'organizzami la settimana tenendo conto delle prove con la band'], ['heavy', 'riassumi come è andato il mese'],
  ['heavy', 'come sto andando con l\'EP, riesco a finire per fine novembre?'], ['heavy', 'ho troppe cose, aiutami a decidere cosa tagliare questa settimana'],
  ['heavy', 'rivedi tutto il piano: ho cambiato lavoro e ora finisco alle 17'], ['heavy', 'pianifica la preparazione dell\'esame di diritto privato in sei settimane con un ripasso finale'],
  ['heavy', 'fammi una strategia per far uscire l\'EP e promuoverlo senza stressarmi'], ['heavy', 'analizza quando rendo di più e riorganizza di conseguenza'],
  ['heavy', 'cosa mi consigli di fare questo weekend considerando che ho tre scadenze lunedì?'], ['heavy', 'fammi il bilancio della settimana e dimmi cosa non sta funzionando'],
  ['heavy', 'ho un mese di vacanza a luglio: come divido studio e allenamento?'], ['heavy', 'prepara un piano per trasferirmi a Milano entro marzo'],
  ['heavy', 'riorganizza le prossime tre settimane perché mi hanno spostato la consegna'], ['heavy', 'quanto tempo mi servirà in tutto per chiudere l\'EP?'],
].map(([kind, text], i) => ({ task: 'route', id: `route-${i + 1}`, kind, gold: kind === 'heavy' ? 'heavy' : 'fast', text }));

function routeState() {
  const t = (id, title, d = 30) => ({ id, title, kind: 'task', status: 'todo', duration: d, baseDuration: d, priority: 2, energy: 2, dependsOn: [], spent: 0, createdAt: 1, updatedAt: 1 });
  return migrate({ onboarded: true, items: [t('t1', 'Spesa'), t('t2', 'Beat 02', 120), t('t3', 'Relazione', 240), t('t4', 'Mix 02', 90)],
    recurring: [{ id: 'rl', title: 'Lavoro', start: 540, end: 1110, weekdays: [1, 2, 3, 4, 5], skip: [] }] }, at('10:00'));
}

/**
 * Per un messaggio: se il codice lo gestisce da solo → { code: true } (niente da misurare); altrimenti le due opzioni
 * (veloce / capace) con il punteggio delle regole.
 */
export function buildRoute(c) {
  const s = routeState();
  const quick = localParse(c.text, s, at('10:00'));
  if (quick.simple && quick.ops?.length) return { code: true };
  return { options: routeOptions(c.text, quick).filter((o) => o.id !== 'base'), task: ROUTE_TASK, state: `Messaggio dell'utente: «${c.text}»` };
}

// ---------------------------------------------------------------- 2. Quale obiettivo dà il tono alla schermata
export const SCENE_TASK = 'Quale obiettivo deve dare il tono alla schermata adesso? Quello a cui l\'utente sta lavorando; se nessuno, quello con la scadenza più imminente che ha sessioni vicine.';
const G = {
  ep: { id: 'g_ep', title: 'Far uscire l\'EP', due: '2026-11-30' },
  es: { id: 'g_es', title: 'Esame di diritto privato', due: '2026-10-15' },
  es1: { id: 'g_es', title: 'Esame di diritto privato', due: '2026-10-13' },
  es0: { id: 'g_es', title: 'Esame di diritto privato', due: '2026-10-12' },
  es2: { id: 'g_es', title: 'Esame di diritto privato', due: '2026-10-14' },
  ma: { id: 'g_ma', title: 'Maratona di Roma', due: '2027-03-21' },
  vi: { id: 'g_vi', title: 'Viaggio in Giappone', due: '2026-10-14' },
  te: { id: 'g_te', title: 'Tesi', due: '2026-12-10' },
  te2: { id: 'g_te', title: 'Tesi', due: '2026-12-05' },
};
let n = 0;
const S = (g, title, date, hm, dur, extra = {}) => ({ id: 's' + ++n, title, kind: 'task', status: 'todo', date, start: parseHM(hm), duration: dur, baseDuration: dur, priority: 2, energy: 2, dependsOn: [], goalId: g.id, spent: 0, createdAt: 1, updatedAt: 1, ...extra });
const TOM = '2026-10-13', IN4 = '2026-10-16';
export const SCENE_CASES = [
  { id: 'ep-in-corso', now: '21:30', gold: 'g_ep', goals: [G.ep, G.es], items: [S(G.ep, 'Beat 03', DAY, '21:00', 90), S(G.es, 'Capitolo 4', TOM, '10:00', 90)] },
  { id: 'esame-mattina', now: '08:30', gold: 'g_es', goals: [G.ep, G.es], items: [S(G.es, 'Capitolo 2', DAY, '10:00', 90), S(G.ep, 'Beat 03', TOM, '21:00', 90)] },
  { id: 'esame-vicino', now: '15:00', gold: 'g_es', goals: [G.ep, G.es1], items: [S(G.es1, 'Ripasso', DAY, '17:00', 90), S(G.ep, 'Beat 03', DAY, '21:00', 90)] },
  { id: 'maratona-in-corso', now: '18:45', gold: 'g_ma', goals: [G.ep, G.ma], items: [S(G.ma, 'Lungo 15 km', DAY, '18:30', 60), S(G.ep, 'Mix 01', DAY, '21:00', 90)] },
  { id: 'viaggio-partenza', now: '10:30', gold: 'g_vi', goals: [G.ep, G.vi], items: [S(G.vi, 'Preparare la valigia', DAY, '11:00', 60), S(G.ep, 'Mix 01', DAY, '21:00', 90)] },
  { id: 'solo-domani', now: '12:00', gold: 'g_es', goals: [G.ep, G.es2], items: [S(G.es2, 'Capitolo 5', TOM, '10:00', 90), S(G.ep, 'Beat 04', IN4, '21:00', 90)] },
  { id: 'tre-obiettivi', now: '09:00', gold: 'g_es', goals: [G.ep, G.es0, G.te], items: [S(G.es0, 'Ripasso finale', DAY, '09:30', 90), S(G.te, 'Capitolo 2', DAY, '15:00', 90), S(G.ep, 'Beat 03', DAY, '21:00', 90)] },
  { id: 'sera-ep-poi-tesi', now: '20:30', gold: 'g_ep', goals: [G.ep, G.te], items: [S(G.ep, 'Beat 03', DAY, '21:00', 90), S(G.te, 'Capitolo 2', TOM, '10:00', 90)] },
  { id: 'ep-fatto', now: '22:00', gold: 'g_es', goals: [G.ep, G.es1], items: [S(G.ep, 'Beat 02', DAY, '20:00', 90, { status: 'done', doneAt: at('21:30'), actual: 90 }), S(G.ep, 'Beat 03', IN4, '21:00', 90), S(G.es1, 'Capitolo 6', TOM, '10:00', 90)] },
  { id: 'difficile-ep-in-corso-esame-oggi', hard: true, now: '14:00', gold: 'g_ep', goals: [G.ep, G.es0], items: [S(G.ep, 'Mix 01', DAY, '13:30', 120), S(G.es0, 'Ripasso finale', DAY, '16:00', 90)] },
  { id: 'difficile-due-simili', hard: true, now: '11:00', gold: 'g_ep', goals: [G.ep, G.te2], items: [S(G.ep, 'Beat 03', TOM, '21:00', 90), S(G.te2, 'Capitolo 2', TOM, '10:00', 90)] },
];

export function buildScene(c) {
  const now = at(c.now);
  const state = migrate({ onboarded: true, goals: c.goals.map((g) => ({ ...g, projectId: null, note: '', at: now - 20 * 864e5, planned: true })), items: c.items }, now);
  const plan = planDays(state, now, 14);
  const options = sceneGoalOptions({ state, plan, now, today: DAY });
  return { options, task: SCENE_TASK, state: stateText({ state, plan, now, today: DAY }) };
}

export const ALL_CASES = [...ROUTE_CASES, ...SCENE_CASES.map((c) => ({ task: 'scene', ...c }))];
export const build = (c) => (c.task === 'route' ? buildRoute(c) : buildScene(c));
