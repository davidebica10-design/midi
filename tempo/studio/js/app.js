// tempo studio: interfaccia. Carosello di brani e calendario delle uscite → brano (varianti, definitiva, ok, adesso, registro) → pagina ok per l'artista.
import {
  load, save, saveFailed, snapshot, undo, canUndo, sanitizeState, emptyState, demoState, STAGES,
  trackOf, versionsOf, latestVersion, approvalsOf, openTasks, logOf, statusOf, findByHash, approvedVersion,
  addTrack, deleteTrack, addVersion, deleteVersion, setStage, toggleTask, renameTrack, applyOps,
  snapshotOf, changesSince, markShared, fromBackup, dataTooNew, setFinal, finalVersion, setRelease, renameVersion, variantName, releasesIn, duesIn, collaborators,
} from './store.js';
import { h, fmtDur, fmtDay, fmtTime, fmtDue, fmtSize, fmtPrint, extOf, count, dateKey, pad2, seedOf } from './util.js';
import { sha256 } from './hash.js';
import { putAudio, deleteAudio, clearAudio, audioUrl, analyze, persistStorage } from './audio.js';
import { parseChat, participants, extract, readChatFile, sampleChat } from './chat.js';
import { aiExtract, aiReady, PRESETS } from './ai.js';
import { encodeAsk, decodeAsk, askLink, askText, replyText, waLink, safeUrl, encodeSnap, decodeSnap, snapLink, snapText } from './share.js';
import { icon } from './icons.js';
import { cover } from './covers.js';
import { C, stageNum } from './copy.js';

const S = load();
if (/[?&]demo\b/.test(location.search) && !S.tracks.length) Object.assign(S, demoState());

const $app = document.getElementById('app');
const $sheets = document.getElementById('sheets');
const $toast = document.getElementById('toast');
const $player = document.getElementById('player');
const $fileAudio = document.getElementById('file-audio');
const $fileVerify = document.getElementById('file-verify');

// ---------------------------------------------------------------- stato → schermo
function commit(label, fn) {
  snapshot(S, label);
  const r = fn();
  save(S);
  render();
  return r;
}

function route() {
  if (/^#\/cal\/?$/.test(location.hash)) return { name: 'cal' };
  const m = location.hash.match(/^#\/(t|ok|s)\/(.+)$/);
  return m ? { name: m[1], arg: decodeURIComponent(m[2]) } : { name: 'lib' };
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else render(); };

function render() {
  const r = route();
  document.body.dataset.route = r.name;
  $app.replaceChildren();
  if (dataTooNew()) $app.append(h('div', { class: 'alert', role: 'alert' }, C.tooNew));
  else if (saveFailed()) $app.append(h('div', { class: 'alert', role: 'alert' }, C.saveFail));
  // il dock sta fuori dalla vista: l'animazione d'entrata usa transform, che romperebbe position: fixed
  if (r.name === 't' && trackOf(S, r.arg)) $app.append(h('div', { class: 'ambient', 'aria-hidden': 'true' }, cover(r.arg)), trackView(trackOf(S, r.arg)), dock(trackOf(S, r.arg)));
  else if (r.name === 'ok') $app.append(artistView(r.arg));
  else if (r.name === 's') $app.append(snapView(r.arg));
  else if (r.name === 'cal') $app.append(calendarView(), tabbar('cal'));
  else $app.append(...homeView(), tabbar('lib'));
  renderPlayer();
}

window.addEventListener('hashchange', () => { closeSheets(); render(); window.scrollTo(0, 0); });

// ---------------------------------------------------------------- home: carosello di brani
// stato della vista in memoria: brano in primo piano e mese del calendario
const ui = { focus: null, cal: null };

function homeView() {
  const tracks = S.tracks;
  if (!tracks.some((t) => t.id === ui.focus)) ui.focus = tracks[0]?.id || null;
  const focus = () => trackOf(S, ui.focus);
  const ambient = h('div', { class: 'ambient', 'aria-hidden': 'true' });
  const avatars = h('div', { class: 'bb-avatars' });
  const info = h('section', { class: 'focus-info', 'aria-live': 'polite' });
  const paint = () => {
    const t = focus();
    ambient.replaceChildren(...(t ? [cover(t.id)] : []));
    avatars.replaceChildren(avatarStack(t?.artist, { onclick: openSettings, label: t?.artist ? `profilo. in primo piano: ${t.title}, con ${t.artist}` : 'profilo e impostazioni' }));
    info.replaceChildren(...(t ? focusInfo(t) : [
      h('h2', { class: 'focus-title' }, C.emptyTitle),
      h('button', { class: 'btn ghost', onclick: loadDemo }, C.demo)]));
  };

  const carousel = h('div', { class: 'carousel', role: 'list', 'aria-label': C.library },
    tracks.length ? tracks.map((t) => h('div', { class: 'card', role: 'listitem', dataset: { id: t.id } },
      h('button', {
        class: 'card-btn', 'aria-label': `${t.title}${t.artist ? `, con ${t.artist}` : ''}. ${statusOf(S, t.id).text}. apri`,
        onclick: (e) => {
          const card = e.currentTarget.parentElement;
          if (ui.focus === t.id) go(`#/t/${t.id}`);
          else card.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
        },
      }, h('span', { class: 'cover card-cover' }, cover(t.id)))))
      : h('div', { class: 'card', role: 'listitem' }, h('button', { class: 'card-btn card-new', onclick: openNewTrack, 'aria-label': C.newTrack }, icon('plus', 34))));

  // il brano più vicino al centro diventa quello in primo piano; i vicini rimpiccioliscono
  let raf = 0;
  const update = () => {
    raf = 0;
    const box = carousel.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    let best = null;
    let bd = Infinity;
    for (const c of carousel.children) {
      const r = c.getBoundingClientRect();
      const d = (r.left + r.width / 2 - mid) / (r.width || 1);
      c.style.setProperty('--d', Math.min(1, Math.abs(d)).toFixed(3));
      if (Math.abs(d) < bd) { bd = Math.abs(d); best = c; }
    }
    const id = best?.dataset.id;
    if (id && id !== ui.focus) { ui.focus = id; paint(); }
  };
  carousel.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  paint();
  requestAnimationFrame(() => {
    const card = [...carousel.children].find((c) => c.dataset.id === ui.focus);
    if (card) carousel.scrollLeft = card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;
    update();
  });

  // la luce sta fuori dalla vista: l'animazione d'entrata usa transform, che romperebbe position: fixed
  return [ambient, h('main', { class: 'view home' },
    topbarR(avatars),
    carousel,
    info)];
}

function focusInfo(t) {
  // solo titolo e con chi: il resto è nella pagina del brano
  return [
    h('h2', { class: 'focus-title' }, t.title),
    t.artist ? h('p', { class: 'focus-meta' }, t.artist) : null,
  ];
}

/** Monogramma tondo, come nei Messaggi. Il colore viene dal nome: stesso nome, stesso colore. */
const TONES = ['#ff5b0b', '#2747ff', '#ffcf1f', '#8b8a85', '#ecebe6'];
function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0][0]).toUpperCase();
}
function avatar(name, { me = false, size = 40 } = {}) {
  const ini = initials(name);
  const tone = me ? null : TONES[seedOf(String(name).toLowerCase()) % TONES.length];
  return h('span', { class: `avatar${me ? ' me' : ''}`, style: `--s:${size}px${tone ? `;--tone:${tone}` : ''}`, 'aria-hidden': 'true' }, ini || icon('user', Math.round(size * 0.55)));
}
/** Tu, grande; il collaboratore del brano, piccolo in basso a destra. Solo nomi scritti da te: niente account, niente dati da fuori. */
function avatarStack(collab, { onclick, label, big = 46 } = {}) {
  return h('button', { class: 'avatars', onclick, 'aria-label': label || 'profilo' },
    collab ? h('span', { class: 'avatar-back' }, avatar(collab, { size: Math.round(big * 0.7) })) : null,
    h('span', { class: 'avatar-front' }, avatar(S.me.name, { me: true, size: big })));
}
/** Testata minima di home e calendario: solo gli avatar, in alto a destra. */
const topbarR = (kid) => h('header', { class: 'topbar-r' }, kid);

// ---------------------------------------------------------------- barra in basso: brani, calendario, +
function tabbar(active) {
  const tab = (key, hash, ic, label) => h('a', { class: `tab${active === key ? ' on' : ''}`, href: hash, 'aria-current': active === key ? 'page' : null, 'aria-label': label, title: label }, icon(active === key ? `${ic}Fill` : ic, 26));
  return h('nav', { class: 'tabbar', 'aria-label': 'sezioni' },
    h('div', { class: 'tabs glass' }, tab('lib', '#/', 'card', C.library), tab('cal', '#/cal', 'grid', C.calendar)),
    h('button', { class: 'tab-add glass', onclick: openNewTrack, 'aria-label': C.newTrack, title: C.newTrack },
      h('img', { src: 'icons/figma/croce.svg', width: 24, height: 24, alt: '' })));
}

// ---------------------------------------------------------------- calendario delle uscite
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function calendarView() {
  const now = new Date();
  ui.cal ||= { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = ui.cal;
  const shift = (d) => { const x = new Date(y, m + d, 1); ui.cal = { y: x.getFullYear(), m: x.getMonth() }; render(); };
  const today = dateKey(Date.now());
  const rel = releasesIn(S, y, m);
  const dues = duesIn(S, y, m);
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // lunedì per primo
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'day blank', 'aria-hidden': 'true' }));
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const out = rel.filter((t) => t.release === key);
    const due = dues.filter((k) => k.due === key);
    const label = [`${d} ${MONTHS[m]}`, out.length && `${count(out.length)} uscite: ${out.map((t) => t.title).join(', ')}`, due.length && `${count(due.length)} scadenze`].filter(Boolean).join('. ');
    cells.push(h(out.length || due.length ? 'button' : 'span', {
      class: `day${out.length ? ' has-out' : ''}${key === today ? ' today' : ''}${key < today ? ' past' : ''}`,
      'aria-label': label, onclick: out.length || due.length ? () => openDay(key) : null,
    },
    out.length ? h('span', { class: 'day-cover' }, cover(out[0].id)) : null,
    h('span', { class: 'day-n mono' }, String(d)),
    out.length > 1 ? h('span', { class: 'day-more mono' }, `+${out.length - 1}`) : null,
    due.length ? h('span', { class: 'day-dot', 'aria-hidden': 'true' }) : null));
  }
  const undated = S.tracks.filter((t) => !t.release);
  const isNow = y === now.getFullYear() && m === now.getMonth();
  return h('main', { class: 'view cal' },
    topbarR(avatarStack(null, { onclick: openSettings, label: 'profilo e impostazioni' })),
    h('header', { class: 'cal-head' },
      h('div', {}, h('p', { class: 'mono muted' }, String(y)), h('h2', { class: 'cal-month' }, MONTHS[m])),
      h('div', { class: 'cal-nav' },
        isNow ? null : h('button', { class: 'btn ghost', onclick: () => { ui.cal = null; render(); } }, 'oggi'),
        iconBtn('back', 'mese prima', () => shift(-1)),
        iconBtn('next', 'mese dopo', () => shift(1)))),
    h('div', { class: 'weekdays mono', 'aria-hidden': 'true' }, ['l', 'm', 'm', 'g', 'v', 's', 'd'].map((d) => h('span', {}, d))),
    h('div', { class: 'month', role: 'group', 'aria-label': `${MONTHS[m]} ${y}` }, cells),
    rel.length ? h('ul', { class: 'rel-list' }, rel.map((t) => relRow(t, () => go(`#/t/${t.id}`), fmtDay(new Date(t.release + 'T12:00').getTime())))) : null,
    undated.length ? block('', 'senza data', [
      h('ul', { class: 'rel-list' }, undated.map((t) => relRow(t, () => openRelease(t), '+ data'))),
    ]) : null);
}

function relRow(t, onclick, side) {
  const st = statusOf(S, t.id);
  return h('li', {}, h('button', { class: 'rel-row', onclick },
    h('span', { class: 'cover rel-cover' }, cover(t.id)),
    h('span', { class: 'rel-text' }, h('b', {}, t.title), h('span', { class: 'mono muted' }, [t.artist, st.text].filter(Boolean).join(' · '))),
    h('span', { class: 'rel-side mono' }, side)));
}

function openDay(key) {
  const out = S.tracks.filter((t) => t.release === key);
  const due = S.tasks.filter((k) => !k.done && k.due === key);
  sheet(fmtDue(key), [
    out.length ? h('p', { class: 'lab mono' }, 'escono') : null,
    out.length ? h('ul', { class: 'rel-list' }, out.map((t) => relRow(t, () => { closeSheets(true); go(`#/t/${t.id}`); }, 'apri'))) : null,
    due.length ? h('p', { class: 'lab mono' }, 'scadenze') : null,
    due.length ? h('ul', { class: 'tasks' }, due.map((k) => h('li', { class: 'task' },
      h('span', { class: 'task-main' }, h('span', { class: 'task-who mono' }, '→ ', k.who === S.me.name && k.who ? 'tu' : k.who || '?', ' · ', trackOf(S, k.trackId)?.title || ''), h('span', { class: 'task-what' }, k.what))))) : null,
  ]);
}

function openRelease(t) {
  const day = h('input', { class: 'field', type: 'date', value: t.release || '', 'aria-label': 'data di uscita' });
  sheet(`uscita · ${t.title}`, [
    day,
    h('button', { class: 'btn primary wide', onclick: () => { commit('data di uscita', () => setRelease(S, t.id, day.value || null)); closeSheets(); toast(day.value ? `esce ${fmtDue(day.value)}.` : 'data tolta.', { undo: true }); } }, 'salva'),
    t.release ? h('button', { class: 'btn ghost wide', onclick: () => { commit('data di uscita', () => setRelease(S, t.id, null)); closeSheets(); toast('data tolta.', { undo: true }); } }, 'togli la data') : null,
  ]);
  setTimeout(() => day.focus(), 60);
}

// ---------------------------------------------------------------- brano
function trackView(t) {
  const versions = versionsOf(S, t.id);
  const last = versions[0];
  const st = statusOf(S, t.id);
  const tasks = openTasks(S, t.id);
  const fin = finalVersion(S, t.id);
  const finOk = fin ? approvalsOf(S, fin.id)[0] : null;

  const view = h('main', { class: 'view track' },
    h('header', { class: 'trackbar' },
      h('button', { class: 'glass round', onclick: () => go('#/'), 'aria-label': `${C.back}: torna al carosello` }, icon('back', 20)),
      avatarStack(t.artist, { onclick: () => openShare(t), label: t.artist ? `condividi con ${t.artist}` : 'condividi' })),
    h('section', { class: 'hero-f' },
      h('div', { class: 'hero-cover-f' },
        h('div', { class: 'cover cover-xl' }, cover(t.id)),
        h('button', { class: 'tab-glass', onclick: () => openTrackActions(t), 'aria-label': 'azioni del brano', 'aria-haspopup': 'dialog' },
          h('span', { class: 'tab-rot' }, h('img', { src: 'icons/figma/linguetta.svg', width: 109.964, height: 54.9824, alt: '' }))))),

    h('div', { class: 'track-head' },
      h('h2', { class: 'track-title' }, t.title),
      h('p', { class: 'track-meta mono' }, [t.artist, st.text].filter(Boolean).join(' · ')),
      h('button', { class: `chip mono release-chip${t.release ? ' set' : ''}`, onclick: () => openRelease(t), 'aria-label': t.release ? `uscita ${fmtDue(t.release)}. cambia` : 'aggiungi data di uscita' }, icon('calendar', 13), t.release ? fmtDue(t.release) : 'uscita')),

    block('01', C.variants, [
      versions.length ? h('ol', { class: 'variants' }, versions.map((v) => variantRow(t, v))) : h('p', { class: 'muted dropnote' }, C.noVersions),
      h('button', { class: 'add-variant', onclick: () => pickAudio(t.id), 'aria-label': C.addVariant }, icon('plus', 18)),
    ]),

    h('nav', { class: 'stages stages-f', 'aria-label': 'fase del brano' },
      STAGES.map((name, i) => h('button', {
        class: `stage${i === t.stage ? ' on' : ''}`, 'aria-pressed': String(i === t.stage),
        onclick: () => commit('fase', () => setStage(S, t.id, i)),
      }, h('span', { class: 'mono' }, stageNum(i)), h('span', {}, name)))),

    block('02', C.now, [
      fin ? h('p', { class: `okline${finOk ? '' : ' warn'}` }, h('span', { class: 'flag-ic' }, icon('flagFill', 14)),
        variantName(fin), finOk ? ` · ✓ ${finOk.by || '?'}` : ' · ',
        finOk ? null : h('button', { class: 'link', onclick: () => openAsk(t, fin) }, 'chiedi ok')) : null,
      st.ok ? h('p', { class: 'okline' }, h('span', { class: 'dot ok' }), `v${st.ok.version.n} ✓ ${st.ok.approval.by || '?'} · ${fmtDay(st.ok.approval.at)}`)
        : h('p', { class: 'okline muted' }, h('span', { class: 'dot' }), last ? 'nessun ok' : 'vuoto'),
      st.ok && last && st.ok.version.id !== last.id ? h('p', { class: 'okline warn' }, h('span', { class: 'dot warn' }), `v${last.n} senza ok · `, h('button', { class: 'link', onclick: () => openAsk(t, last) }, 'chiedi ok')) : null,
      tasks.length ? h('ul', { class: 'tasks' }, tasks.map((k) => taskRow(k))) : h('p', { class: 'muted' }, C.nothingOpen),
      h('button', { class: 'link', onclick: () => openTask(t) }, C.addTask),
    ]),

    h('details', { class: 'block fold' },
      h('summary', { class: 'label mono' }, h('span', {}, '03'), ' ', C.log),
      h('ol', { class: 'log mono' }, logOf(S, t.id).slice(0, 40).map((l) => logRow(l, !!t.sharedAt && l.at > t.sharedAt)))),
  );

  // trascina un file sulla pagina del brano → nuova variante
  view.addEventListener('dragover', (e) => { e.preventDefault(); view.classList.add('dragging'); });
  view.addEventListener('dragleave', (e) => { if (e.target === view) view.classList.remove('dragging'); });
  view.addEventListener('drop', (e) => {
    e.preventDefault();
    view.classList.remove('dragging');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) addBounces(t.id, files);
  });
  return view;
}

/** Linguetta sulla copertina (design figma 5:216): tutte le azioni del brano in un foglio. */
function openTrackActions(t) {
  const last = latestVersion(S, t.id);
  const row = (ic, label, hint, fn, disabled = false) => h('button', { class: 'action-row', disabled, onclick: () => { closeSheets(true); fn(); } },
    h('span', { class: 'action-ic' }, icon(ic, 18)), h('span', { class: 'action-text' }, h('b', {}, label), h('span', { class: 'muted' }, hint)));
  sheet(t.title, [
    h('div', { class: 'actions-list' },
      row('play', C.listen, last ? `${variantName(last)} · v${last.n}` : 'nessuna variante', () => last && play(last), !last),
      row('check', C.askOk, last ? `link per approvare la v${last.n}` : 'serve una variante', () => last && openAsk(t, last), !last),
      row('plus', C.addVariant, 'wav, aiff, mp3. resta su questo dispositivo', () => pickAudio(t.id)),
      row('calendar', 'data di uscita', t.release ? `esce ${fmtDue(t.release)}` : 'per il calendario', () => openRelease(t)),
      row('chat', C.importChat, 'ok, richieste e scadenze dalla chat', () => openImport(t)),
      row('eye', C.verify, 'è il file approvato? sì o no', () => pickVerify()),
      row('more', 'rinomina o elimina', t.artist ? `${t.title} · con ${t.artist}` : t.title, () => openTrackMenu(t))),
  ]);
}

function block(n, label, kids) {
  return h('section', { class: 'block' }, h('h2', { class: 'label mono' }, h('span', {}, n), ' ', label), ...kids);
}

function taskRow(k) {
  const late = k.due && k.due < dateKey(Date.now());
  return h('li', { class: 'task' },
    h('button', { class: 'check', 'aria-label': `segna fatto: ${k.what}`, onclick: () => commit('fatto', () => toggleTask(S, k.id)) }),
    h('span', { class: 'task-main' },
      h('span', { class: 'task-who mono' }, '→ ', k.who === S.me.name && k.who ? 'tu' : k.who || '?'),
      h('span', { class: 'task-what' }, k.what)),
    k.due ? h('span', { class: `task-due mono${late ? ' late' : ''}` }, fmtDue(k.due)) : null);
}

/** Una variante: bandiera per fissarla come definitiva, poi la pillola che suona. */
function variantRow(t, v) {
  const oks = approvalsOf(S, v.id);
  const playing = player.vid === v.id;
  const isFinal = t.finalId === v.id;
  const name = variantName(v);
  return h('li', { class: `variant${playing ? ' playing' : ''}${isFinal ? ' final' : ''}${oks.length ? ' ok' : ''}` },
    h('button', {
      class: 'flag', 'aria-pressed': String(isFinal), title: isFinal ? 'definitiva' : 'fissa come definitiva',
      'aria-label': isFinal ? `${name} è la definitiva. tocca per toglierla` : `fissa ${name} come definitiva`,
      onclick: () => flagVariant(t, v),
    }, icon(isFinal ? 'flagFill' : 'flag', 20)),
    h('div', { class: 'vpill' },
      h('button', { class: 'vmain', onclick: () => play(v), 'aria-label': `${playing && !player.audio.paused ? 'pausa' : 'riproduci'} ${name}` },
        h('span', { class: 'vplay' }, icon(playing && !player.audio.paused ? 'pause' : 'play', 14)),
        h('span', { class: 'vbody' },
          h('span', { class: 'vname' }, name, isFinal ? h('span', { class: 'badge-final mono' }, 'definitiva') : null),
          h('span', { class: 'vmeta mono' }, [`v${v.n}`, fmtDur(v.duration), extOf(v.fileName) || 'audio', `#${fmtPrint(v.hash)}`].join(' · ')),
          wave(v.peaks, playing))),
      h('span', { class: 'vside' },
        oks.length ? h('span', { class: 'chip ok mono', title: oks.map((a) => `${a.by} · ${fmtDay(a.at)}`).join('\n') }, `✓ ${oks[0].by || 'ok'}`)
          : h('button', { class: 'chip mono', onclick: () => openAsk(t, v) }, 'chiedi ok'),
        iconBtn('more', `opzioni ${name}`, () => openVersionMenu(t, v), 'small'))));
}

function flagVariant(t, v) {
  const was = t.finalId === v.id;
  commit('definitiva', () => setFinal(S, t.id, v.id));
  const name = variantName(v);
  if (was) toast(`${name} non è più la definitiva.`, { undo: true });
  else toast(approvalsOf(S, v.id).length ? `${name} è la definitiva.` : `${name} è la definitiva. ancora senza ok.`, { undo: true });
}

function wave(peaks, on) {
  const list = peaks?.length ? peaks : Array.from({ length: 48 }, () => 0.12);
  return h('span', { class: `wave${on ? ' on' : ''}`, 'aria-hidden': 'true' }, list.map((p) => h('i', { style: `height:${Math.max(8, Math.round(p * 100))}%` })));
}

/** Logo «tempo•» centrato (design figma). Su un brano il logo riporta alla libreria. */
function brandbar({ left = null, right = null, home = false } = {}) {
  const logo = h('span', { class: 'logo' }, 'tempo', h('img', { class: 'logo-dot', src: 'icons/figma/punto.svg', width: 11, height: 11, alt: '' }));
  return h('header', { class: 'brandbar' },
    h('div', { class: 'bb-l' }, left),
    home ? h('button', { class: 'logo-btn', onclick: () => go('#/'), 'aria-label': 'tempo, torna ai brani' }, logo) : h('h1', { class: 'logo-btn', 'aria-label': 'tempo' }, logo),
    h('div', { class: 'bb-r' }, right));
}

// ---------------------------------------------------------------- audio: aggiungere, verificare, suonare
function pickAudio(tid) {
  $fileAudio.value = '';
  $fileAudio.onchange = () => addBounces(tid, [...$fileAudio.files]);
  $fileAudio.click();
}

async function addBounces(tid, files) {
  for (const f of files) {
    if (!/^audio\//.test(f.type) && !/\.(wav|aiff?|mp3|m4a|flac|ogg|opus|caf)$/i.test(f.name)) { toast(`${f.name}: non sembra audio. salto.`); continue; }
    toast(`leggo ${f.name}…`, { sticky: true });
    try {
      const buf = await f.arrayBuffer();
      const hash = await sha256(buf);
      const dup = S.versions.find((v) => v.trackId === tid && v.hash === hash);
      if (dup) { toast(`già qui: è la v${dup.n}. stessa impronta, stesso file.`); continue; }
      const { duration, peaks } = await analyze(buf);
      const blobId = `a${hash.slice(0, 20)}`;
      await putAudio(blobId, new Blob([buf], { type: f.type || 'audio/wav' }));
      const { version } = commit('bounce', () => addVersion(S, tid, { hash, fileName: f.name, size: f.size, duration, peaks, blobId }));
      toast(`v${version.n} caricata. impronta ${fmtPrint(hash)}.`, { undo: true });
    } catch (e) {
      toast(`non riesco a leggere ${f.name}: ${e.message || e}`);
    }
  }
}

function pickVerify() {
  $fileVerify.value = '';
  $fileVerify.onchange = async () => {
    const f = $fileVerify.files[0];
    if (!f) return;
    toast('calcolo l’impronta…', { sticky: true });
    const hash = await sha256(await f.arrayBuffer());
    hideToast();
    openVerifyResult(f, hash);
  };
  $fileVerify.click();
}

function openVerifyResult(f, hash) {
  const hit = findByHash(S, hash);
  let head, body;
  if (hit?.approval) {
    head = h('p', { class: 'verdict ok' }, '✓ è lui.');
    body = `${f.name} è la v${hit.version.n} di «${hit.track.title}», approvata da ${hit.approval.by || '?'} il ${fmtDay(hit.approval.at)} alle ${fmtTime(hit.approval.at)}.${hit.track.finalId === hit.version.id ? ' ed è la definitiva.' : ''}`;
  } else if (hit) {
    const ok = approvedVersion(S, hit.track.id);
    head = h('p', { class: 'verdict warn' }, '○ conosciuto, non approvato.');
    body = `è la v${hit.version.n} di «${hit.track.title}»${hit.track.finalId === hit.version.id ? ', la definitiva' : ''}. ${ok ? `l’ok ce l’ha la v${ok.version.n}.` : 'nessuna versione ha ancora un ok.'}`;
  } else {
    head = h('p', { class: 'verdict no' }, '× mai visto.');
    body = 'nessuna versione caricata ha questa impronta. basta un export diverso, un fade, un bit, e cambia.';
  }
  sheet('verifica', [head, h('p', {}, body), h('p', { class: 'mono muted small' }, `sha-256 ${hash}`)]);
}

const player = { audio: new Audio(), vid: null, tid: null };
player.audio.preload = 'metadata';
['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata'].forEach((ev) => player.audio.addEventListener(ev, () => updatePlayer()));

async function play(v) {
  if (player.vid === v.id && player.audio.src) {
    player.audio.paused ? player.audio.play() : player.audio.pause();
    return;
  }
  const url = await audioUrl(v.blobId);
  if (!url) { toast('audio non su questo dispositivo. qui c’è solo l’impronta.'); return; }
  player.vid = v.id;
  player.tid = v.trackId;
  player.audio.src = url;
  player.audio.play().catch(() => {});
  render();
}

function renderPlayer() {
  const v = S.versions.find((x) => x.id === player.vid);
  const t = v && trackOf(S, v.trackId);
  if (!v || !t || route().name === 'ok') { $player.hidden = true; document.body.classList.remove('has-player'); return; }
  $player.hidden = false;
  document.body.classList.add('has-player');
  $player.replaceChildren(
    h('input', { class: 'seek', type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'posizione', oninput: (e) => { const d = player.audio.duration; if (d) player.audio.currentTime = (e.target.value / 1000) * d; } }),
    h('div', { class: 'pl-row' },
      h('button', { class: 'pl-btn', 'aria-label': 'riproduci', onclick: () => (player.audio.paused ? player.audio.play() : player.audio.pause()) }, h('span', { class: 'swap' }, icon('play', 22), icon('pause', 22))),
      h('button', { class: 'pl-cover', onclick: () => go(`#/t/${t.id}`), 'aria-label': `apri ${t.title}` }, cover(t.id)),
      h('div', { class: 'pl-text' }, h('b', {}, t.title), h('span', { class: 'muted' }, variantName(v))),
      h('span', { class: 'pl-time mono muted' }, '0:00')));
  updatePlayer();
}

function updatePlayer() {
  if ($player.hidden) return;
  const a = player.audio;
  const btn = $player.querySelector('.pl-btn');
  if (btn) { btn.classList.toggle('is-playing', !a.paused); btn.setAttribute('aria-label', a.paused ? 'riproduci' : 'pausa'); }
  const seek = $player.querySelector('.seek');
  if (seek && a.duration && document.activeElement !== seek) seek.value = Math.round((a.currentTime / a.duration) * 1000);
  if (seek) seek.style.setProperty('--p', `${a.duration ? (a.currentTime / a.duration) * 100 : 0}%`);
  const tm = $player.querySelector('.pl-time');
  if (tm) tm.textContent = fmtDur(Math.floor(a.currentTime)) === '--:--' ? '0:00' : fmtDur(Math.floor(a.currentTime));
}

// ---------------------------------------------------------------- chiedi ok (producer)
function openAsk(t, v) {
  const audio = h('input', { class: 'field', type: 'url', inputmode: 'url', placeholder: 'https://… (drive, dropbox, wetransfer)', 'aria-label': 'link di ascolto facoltativo' });
  const preview = h('pre', { class: 'msg mono' });
  const ask = () => ({ key: t.id, title: t.title, artist: t.artist, n: v.n, fileName: v.fileName, hash: v.hash.slice(0, 16), audio: safeUrl(audio.value), phone: S.me.phone, by: S.me.name });
  const link = () => askLink(appBase(), encodeAsk(ask()));
  const refresh = () => { preview.textContent = askText(ask(), link()); };
  audio.addEventListener('input', refresh);
  refresh();
  sheet(`chiedi ok · v${v.n}`, [
    h('label', { class: 'lab mono' }, 'link di ascolto · facoltativo'),
    audio,
    !S.me.phone ? h('p', { class: 'warnbox small' }, 'senza il tuo numero (impostazioni) la risposta chiede a chi mandarla.') : h('p', { class: 'muted small' }, C.linkHasPhone),
    h('label', { class: 'lab mono' }, 'messaggio'),
    preview,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => window.open(waLink('', preview.textContent), '_blank', 'noopener') }, 'apri whatsapp'),
      h('button', { class: 'btn', onclick: () => copy(preview.textContent, 'messaggio copiato.') }, 'copia'),
      h('button', { class: 'btn ghost', onclick: () => { closeSheets(); location.hash = `#/ok/${encodeAsk(ask())}`; } }, 'anteprima')),
  ]);
}

// ---------------------------------------------------------------- condividi lo stato del brano
/** Indirizzo dell'app senza query (?demo) né frammento: base dei link condivisi. */
const appBase = () => `${location.origin}${location.pathname}`;
const newsOf = (t) => (t.sharedAt ? logOf(S, t.id).filter((l) => l.at > t.sharedAt).length : 0);

function dock(t) {
  const news = newsOf(t);
  return h('div', { class: 'dock' },
    h('button', { class: 'btn primary dock-btn', onclick: () => openShare(t) },
      icon('share', 18),
      h('span', {}, 'condividi'),
      news ? h('span', { class: 'dock-badge mono', 'aria-label': `${count(news)} novità` }, count(news)) : null));
}

async function openShare(t) {
  const versions = versionsOf(S, t.id);
  const st = statusOf(S, t.id);
  const tasks = openTasks(S, t.id);
  const news = newsOf(t);
  const audio = h('input', { class: 'field', type: 'url', inputmode: 'url', placeholder: 'https://… (drive, dropbox)', 'aria-label': 'link di ascolto facoltativo' });
  const preview = h('pre', { class: 'msg mono' }, '…');
  let link = '';
  let payload = '';
  let message = '';
  const build = async () => {
    const snap = snapshotOf(S, t.id, { audio: safeUrl(audio.value) });
    payload = await encodeSnap(snap);
    link = snapLink(appBase(), payload);
    message = snapText(snap, link, news);
    // nell'anteprima il link lungo si accorcia; nel messaggio vero resta intero
    preview.replaceChildren(message.replace(link, ''), h('span', { class: 'msg-link' }, `${link.slice(0, link.indexOf('#') + 7)}… · ${link.length} caratteri`));
  };
  let timer = null;
  audio.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(build, 200); });
  const shared = (how) => {
    markShared(S, t.id);
    save(S);
    closeSheets();
    render();
    toast(how);
  };
  const canShare = typeof navigator.share === 'function';
  sheet(t.artist ? `condividi con ${t.artist}` : 'condividi', [
    h('ul', { class: 'inside mono' },
      h('li', {}, h('span', {}, count(versions.length)), ' versioni'),
      h('li', {}, h('span', {}, st.ok ? `v${st.ok.version.n}` : '—'), ' approvata'),
      h('li', {}, h('span', {}, count(tasks.length)), ' cose aperte'),
      h('li', { class: news ? 'hot' : '' }, h('span', {}, t.sharedAt ? count(news) : 'prima'), t.sharedAt ? ' novità' : ' volta')),
    h('label', { class: 'lab mono' }, 'link di ascolto · facoltativo'),
    audio,
    h('label', { class: 'lab mono' }, 'messaggio'),
    preview,
    h('div', { class: 'row' },
      canShare ? h('button', { class: 'btn primary', onclick: async () => {
        try { await navigator.share({ text: message }); shared('condiviso. la prossima volta vedrà solo le novità.'); } catch (e) { if (e?.name !== 'AbortError') toast('condivisione non riuscita. copia il link.'); }
      } }, icon('share', 16), 'condividi…') : null,
      h('button', { class: `btn${canShare ? '' : ' primary'}`, onclick: () => { window.open(waLink('', message), '_blank', 'noopener'); shared('aperto whatsapp. link segnato come inviato.'); } }, icon('chat', 16), 'whatsapp'),
      h('button', { class: 'btn', onclick: async () => { await copy(link, 'link copiato.'); markShared(S, t.id); save(S); } }, icon('link', 16), 'copia'),
      h('button', { class: 'btn ghost', onclick: () => { closeSheets(); location.hash = `#/s/${payload}`; } }, icon('eye', 16), 'anteprima')),
    S.me.phone ? h('p', { class: 'muted small foot' }, C.linkHasPhone) : null,
  ]);
  await build();
}

// ---------------------------------------------------------------- pagina di stato (per il collaboratore)
function snapView(payload) {
  const main = h('main', { class: 'view snap' }, h('p', { class: 'mono muted loading' }, 'apro il link…'));
  decodeSnap(payload).then((sn) => {
    if (!sn) { main.replaceChildren(h('p', { class: 'mono muted' }, 'stato del brano'), h('h1', { class: 'title' }, 'mmh.'), h('p', {}, C.badLink)); return; }
    const items = snapContent(sn);
    const bar = items.pop();
    main.replaceChildren(...items.filter(Boolean));
    if (main.isConnected) main.after(bar);
  });
  return main;
}

function snapContent(sn) {
  const last = sn.versions[0];
  const ok = sn.versions.find((v) => v.okBy);
  const isNew = (at) => !!(sn.since && at && at > sn.since);
  const news = sn.since ? sn.log.filter((l) => l.at > sn.since) : [];
  const ask = last ? { n: last.n, hash: last.hash, title: sn.title } : null;
  const reply = waLink(sn.phone, `re: ${sn.title} · `);
  return [
    h('div', { class: 'brand small' }, h('b', {}, C.brand), h('span', {}, 'stato del brano')),
    h('section', { class: 'hero' },
      h('div', { class: 'cover hero-cover' }, cover(sn.key || sn.title)),
      h('div', { class: 'hero-text' },
        h('p', { class: 'mono muted' }, `brano · ${stageNum(sn.stage)} ${STAGES[sn.stage]}`),
        h('h1', { class: 'title' }, sn.title),
        h('p', { class: 'muted' }, [sn.by && `da ${sn.by}`, sn.artist && `con ${sn.artist}`].filter(Boolean).join(' · ') || ' '),
        h('p', { class: 'mono muted small' }, `foto del ${fmtDay(sn.at)} alle ${fmtTime(sn.at)}`),
        sn.release ? h('p', { class: 'mono small' }, `◆ esce ${fmtDue(sn.release)}`) : null)),
    h('div', { class: 'stages ro', role: 'img', 'aria-label': `fase ${stageNum(sn.stage)} di 06: ${STAGES[sn.stage]}` },
      STAGES.map((name, i) => h('span', { class: `stage${i === sn.stage ? ' on' : ''}${i < sn.stage ? ' past' : ''}` }, h('span', { class: 'mono' }, stageNum(i)), h('span', {}, name)))),
    news.length ? h('section', { class: 'block news' },
      h('h2', { class: 'label mono' }, h('span', {}, '◆'), ` ${count(news.length)} novità dall’ultimo link`),
      h('ol', { class: 'log mono' }, news.map((l) => logRow(l, true)))) : null,
    block('01', C.now, [
      ok ? h('p', { class: 'okline' }, h('span', { class: 'dot ok' }), `v${ok.n} approvata${ok.okBy ? ` da ${ok.okBy}` : ''}${ok.okAt ? ` · ${fmtDay(ok.okAt)}` : ''}`)
        : h('p', { class: 'okline muted' }, h('span', { class: 'dot' }), last ? 'nessun ok ancora.' : 'niente da approvare.'),
      ok && last && ok.n !== last.n ? h('p', { class: 'okline warn' }, h('span', { class: 'dot warn' }), `v${last.n} è più nuova dell’ok.`) : null,
      sn.final ? h('p', { class: 'okline' }, h('span', { class: 'flag-ic' }, icon('flagFill', 14)), `definitiva per ${sn.by || 'chi produce'}: v${sn.final}`) : null,
      sn.tasks.length ? h('ul', { class: 'tasks' }, sn.tasks.map((k) => h('li', { class: 'task ro' },
        h('span', { class: 'check ro', 'aria-hidden': 'true' }),
        h('span', { class: 'task-main' }, h('span', { class: 'task-who mono' }, '→ ', k.who || '?'), h('span', { class: 'task-what' }, k.what)),
        k.due ? h('span', { class: 'task-due mono' }, fmtDue(k.due)) : null))) : h('p', { class: 'muted' }, C.nothingOpen),
    ]),
    block('02', C.versions, [
      sn.versions.length ? h('ol', { class: 'versions' }, sn.versions.map((v) => h('li', { class: `vrow ro${v.okBy ? ' ok' : ''}` },
        h('span', { class: 'vmain' },
          h('span', { class: 'vn mono' }, `v${v.n}`),
          h('span', { class: 'vbody' },
            h('span', { class: 'vname' }, v.fileName || `versione ${v.n}`, isNew(v.addedAt) ? h('span', { class: 'badge-new mono' }, 'nuova') : null),
            h('span', { class: 'vmeta mono' }, `${fmtDur(v.duration)} · #${fmtPrint(v.hash)}`))),
        h('span', { class: 'vside' }, v.okBy ? h('span', { class: 'chip ok mono' }, h('span', {}, icon('check', 12)), v.okBy) : h('span', { class: 'chip mono quiet' }, 'da sentire'))))) : h('p', { class: 'muted' }, 'nessun bounce, per ora.'),
      sn.audio ? h('a', { class: 'link', href: sn.audio, target: '_blank', rel: 'noopener noreferrer' }, 'apri il link di ascolto ↗') : null,
    ]),
    sn.log.length ? block('03', C.log, [h('ol', { class: 'log mono' }, sn.log.map((l) => logRow(l, isNew(l.at))))]) : null,
    h('p', { class: 'mono muted small foot' }, 'questa è una foto: non si aggiorna da sola. per vedere le novità chiedi un link nuovo.'),
    h('div', { class: 'dock' },
      last && (!ok || ok.n !== last.n)
        ? h('a', { class: 'btn primary dock-btn', href: waLink(sn.phone, replyText('ok', ask)), target: '_blank', rel: 'noopener noreferrer' }, icon('check', 18), h('span', {}, `approvo v${last.n}`))
        : h('a', { class: 'btn primary dock-btn', href: reply, target: '_blank', rel: 'noopener noreferrer' }, icon('chat', 18), h('span', {}, sn.by ? `rispondi a ${sn.by}` : 'rispondi su whatsapp')),
      last && (!ok || ok.n !== last.n) ? h('a', { class: 'icon-btn big', href: reply, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'rispondi su whatsapp', title: 'rispondi su whatsapp' }, icon('chat', 20)) : null),
  ];
}

function logRow(l, fresh) {
  return h('li', { class: `k-${l.kind}${fresh ? ' fresh' : ''}` },
    h('span', { class: 'when' }, `${fmtDay(l.at)} ${fmtTime(l.at)}`),
    h('span', { class: 'who' }, l.who || '—'),
    h('span', { class: 'what' }, l.text));
}

// ---------------------------------------------------------------- pagina dell'artista
function artistView(payload) {
  const a = decodeAsk(payload.replace(/^\/?/, ''));
  if (!a) return h('main', { class: 'view artist' }, h('p', { class: 'mono muted' }, C.artistTitle), h('h1', { class: 'title' }, 'mmh.'), h('p', {}, C.badLink));
  const note = h('textarea', { class: 'field', rows: 3, placeholder: C.changesPh, 'aria-label': 'modifiche richieste' });
  const changes = h('div', { class: 'changes', hidden: true },
    note,
    h('button', { class: 'btn primary wide', onclick: () => window.open(waLink(a.phone, replyText('modifiche', a, note.value)), '_blank', 'noopener') }, C.sendChanges));
  return h('main', { class: 'view artist' },
    h('div', { class: 'brand small' }, h('b', {}, C.brand), h('span', {}, C.artistTitle)),
    h('div', { class: 'cover artist-cover' }, cover(a.key || a.title)),
    h('h1', { class: 'title' }, a.title),
    h('p', { class: 'muted' }, a.by ? `da ${a.by}` : '', a.by && a.artist ? ' · ' : '', a.artist ? `per ${a.artist}` : ''),
    h('dl', { class: 'spec mono' },
      h('dt', {}, 'versione'), h('dd', {}, `v${a.n}`),
      a.fileName ? [h('dt', {}, 'file'), h('dd', {}, a.fileName)] : null,
      h('dt', {}, 'impronta'), h('dd', {}, fmtPrint(a.hash))),
    a.audio ? h('div', { class: 'listen' }, h('audio', { controls: true, preload: 'none', src: a.audio }), h('a', { class: 'link', href: a.audio, target: '_blank', rel: 'noopener noreferrer' }, 'apri il link di ascolto ↗')) : h('p', { class: 'muted small' }, 'l’audio ti arriva nella chat, come sempre. ascoltalo, poi torna qui.'),
    h('a', { class: 'btn primary wide big-btn', href: waLink(a.phone, replyText('ok', a)), target: '_blank', rel: 'noopener noreferrer' }, C.approve),
    h('button', { class: 'btn wide', onclick: () => { changes.hidden = !changes.hidden; if (!changes.hidden) note.focus(); } }, C.changes),
    changes,
    h('p', { class: 'mono muted small foot' }, C.artistNoAccount));
}

// ---------------------------------------------------------------- importa chat
function openImport(t) {
  const versions = versionsOf(S, t.id);
  const file = h('input', { type: 'file', accept: '.txt,.zip,text/plain,application/zip', class: 'field', 'aria-label': 'file della chat' });
  const text = h('textarea', { class: 'field mono', rows: 5, placeholder: '[12/11/26, 18:04:22] midi: la v3 spacca, per me è ok', 'aria-label': 'testo della chat' });
  const out = h('div', { class: 'proposals' });
  let msgs = [];
  let me = S.me.name;
  let props = [];

  const run = () => {
    msgs = parseChat(text.value);
    out.replaceChildren();
    if (!text.value.trim()) return;
    if (!msgs.length) { out.append(h('p', { class: 'warnbox' }, 'non riconosco il formato. serve l’export di whatsapp, con data e nome all’inizio di ogni riga.')); return; }
    const people = participants(msgs);
    if (!people.some((p) => p.toLowerCase() === me.toLowerCase())) me = '';
    props = extract(msgs, { me, versions });
    draw(people);
  };

  const draw = (people) => {
    out.replaceChildren(
      h('p', { class: 'lab mono' }, `${count(msgs.length)} messaggi · chi sei tu?`),
      h('div', { class: 'chips' }, people.map((p) => h('button', { class: `chip${p === me ? ' on' : ''}`, 'aria-pressed': String(p === me), onclick: () => { me = p; props = extract(msgs, { me, versions }); draw(people); } }, p))),
      props.length ? h('ul', { class: 'plist' }, props.map((p) => proposalRow(p))) : h('p', { class: 'muted' }, 'niente da registrare. o era solo chiacchiera, o servono gli occhi dell’ai.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: !props.length, onclick: apply }, `registra ${count(props.filter((p) => p.on).length)}`),
        aiReady(S.ai) ? h('button', { class: 'btn', onclick: runAi }, 'rileggi con ai') : h('span', { class: 'muted small' }, 'ai spenta · impostazioni')),
    );
  };

  const proposalRow = (p) => {
    if (p.on == null) p.on = p.confidence === 'alta';
    const o = p.op;
    const icon = { approve: '✓', request: '✎', task: '→', decide: '◆' }[o.action];
    const main = o.action === 'approve' ? `ok di ${o.by} su ${o.version ? o.version.replace(/^([0-9a-f]{8,})$/, '#$1') : 'ultima versione'}`
      : o.action === 'request' ? `${o.by} chiede modifiche${o.text ? `: ${o.text}` : ''}`
        : o.action === 'task' ? `${o.who === me && me ? 'tu' : o.who || '?'} · ${o.what}${o.due ? ` · ${fmtDue(o.due)}` : ''}`
          : o.text;
    const box = h('input', { type: 'checkbox', checked: p.on, onchange: (e) => { p.on = e.target.checked; out.querySelector('.btn.primary').textContent = `registra ${count(props.filter((x) => x.on).length)}`; } });
    return h('li', { class: `prop c-${p.confidence}` },
      h('label', {}, box, h('span', { class: 'picon mono' }, icon), h('span', { class: 'pbody' }, h('span', {}, main), h('span', { class: 'mono muted small' }, `${p.why}${p.msg ? ` · «${p.msg.text.slice(0, 60)}»` : ''}`))));
  };

  const apply = () => {
    const ops = props.filter((p) => p.on).map((p) => p.op);
    if (me && !S.me.name) S.me.name = me;
    const res = commit('importa chat', () => applyOps(S, t.id, ops));
    closeSheets();
    toast(`${count(res.done.length)} registrate${res.errors.length ? ` · ${count(res.errors.length)} saltate (${res.errors[0]})` : ''}.`, { undo: res.done.length > 0 });
  };

  const runAi = async () => {
    const host = aiHost(S.ai.base);
    // prima volta per questo servizio: la chat contiene messaggi di altre persone, chiedi conferma qui
    if (S.ai.consent !== host) {
      out.querySelector('.consent')?.remove();
      out.append(h('div', { class: 'warnbox consent' },
        h('p', {}, `la chat va a ${host}. ${C.aiConsent}`),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { S.ai.consent = host; save(S); runAi(); } }, `sì, manda a ${host}`),
          h('button', { class: 'btn ghost', onclick: () => out.querySelector('.consent')?.remove() }, 'no'))));
      return;
    }
    out.querySelector('.btn:not(.primary)')?.setAttribute('disabled', '');
    toast('l’ai sta leggendo…', { sticky: true });
    try {
      props = await aiExtract(msgs, { me, versions, cfg: S.ai });
      hideToast();
      draw(participants(msgs));
    } catch (e) {
      toast(`ai: ${e.message || e}`);
      draw(participants(msgs));
    }
  };

  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    try { text.value = await readChatFile(file.files[0]); run(); } catch (e) { toast(e.message || 'file non leggibile'); }
  });
  text.addEventListener('input', () => { clearTimeout(text._t); text._t = setTimeout(run, 250); });

  sheet(C.importChat, [
    h('p', { class: 'muted' }, C.importChatHint),
    file,
    text,
    h('button', { class: 'link', onclick: () => { text.value = sampleChat(); run(); } }, 'usa una chat di esempio'),
    out,
  ]);
}

const aiHost = (base) => { try { return new URL(base).host || base; } catch { return String(base || '?').slice(0, 60); } };

// ---------------------------------------------------------------- fogli: nuovo brano, cose da fare, menu, impostazioni
function openNewTrack() {
  const title = h('input', { class: 'field', placeholder: 'notte a ortigia', 'aria-label': C.newTrackTitle, maxlength: 80 });
  const artist = h('input', { class: 'field', placeholder: 'midi', 'aria-label': C.newTrackWith, maxlength: 40 });
  const make = (e) => {
    e?.preventDefault();
    if (!title.value.trim()) { title.focus(); title.classList.add('bad'); return; }
    const t = commit('nuovo brano', () => addTrack(S, { title: title.value, artist: artist.value }));
    closeSheets();
    go(`#/t/${t.id}`);
  };
  sheet(C.newTrack, [h('form', { onsubmit: make },
    h('label', { class: 'lab mono' }, C.newTrackTitle), title,
    h('label', { class: 'lab mono' }, C.newTrackWith), artist,
    h('button', { class: 'btn primary wide', type: 'submit' }, C.create))]);
  setTimeout(() => title.focus(), 60);
}

function openTask(t) {
  let who = t.artist || '';
  const people = [S.me.name || 'io', t.artist].filter(Boolean);
  const what = h('input', { class: 'field', placeholder: 'rifare la doppia della strofa 2', 'aria-label': 'cosa', maxlength: 140 });
  const due = h('input', { class: 'field', type: 'date', 'aria-label': 'entro quando' });
  const chips = h('div', { class: 'chips' });
  const drawChips = () => chips.replaceChildren(...people.map((p) => h('button', { type: 'button', class: `chip${p === who ? ' on' : ''}`, onclick: () => { who = p; drawChips(); } }, p)));
  drawChips();
  const add = (e) => {
    e.preventDefault();
    if (!what.value.trim()) { what.focus(); what.classList.add('bad'); return; }
    commit('cosa da fare', () => applyOps(S, t.id, [{ action: 'task', who, what: what.value, due: due.value || null, by: S.me.name }]));
    closeSheets();
  };
  sheet('cosa da fare', [h('form', { onsubmit: add },
    h('label', { class: 'lab mono' }, 'chi'), chips,
    h('label', { class: 'lab mono' }, 'cosa'), what,
    h('label', { class: 'lab mono' }, 'entro · facoltativo'), due,
    h('button', { class: 'btn primary wide', type: 'submit' }, 'aggiungi'))]);
  setTimeout(() => what.focus(), 60);
}

function openTrackMenu(t) {
  const title = h('input', { class: 'field', value: t.title, 'aria-label': 'titolo', maxlength: 80 });
  const artist = h('input', { class: 'field', value: t.artist, 'aria-label': 'artista', maxlength: 40 });
  sheet(t.title, [
    h('label', { class: 'lab mono' }, 'titolo'), title,
    h('label', { class: 'lab mono' }, 'con chi'), artist,
    h('button', { class: 'btn wide', onclick: () => { commit('rinomina', () => renameTrack(S, t.id, { title: title.value, artist: artist.value })); closeSheets(); } }, 'salva'),
    h('button', { class: 'btn danger wide', onclick: () => confirmSheet(`elimino «${t.title}»?`, 'versioni, ok, registro e audio su questo dispositivo. si può annullare subito dopo, l’audio no.', () => {
      const blobs = commit('elimina brano', () => deleteTrack(S, t.id));
      blobs.forEach((b) => deleteAudio(b).catch(() => {}));
      go('#/');
      toast('brano eliminato.', { undo: true });
    }) }, 'elimina brano'),
  ]);
}

function openVersionMenu(t, v) {
  const by = h('input', { class: 'field', value: t.artist || '', placeholder: 'chi approva', 'aria-label': 'chi approva', maxlength: 40 });
  const label = h('input', { class: 'field', value: v.label, placeholder: variantName({ ...v, label: '' }), 'aria-label': 'nome della variante', maxlength: 40 });
  sheet(`v${v.n} · ${variantName(v)}`, [
    h('label', { class: 'lab mono' }, 'nome della variante'),
    h('div', { class: 'row' }, label, h('button', { class: 'btn', onclick: () => { commit('rinomina variante', () => renameVersion(S, v.id, label.value)); closeSheets(); } }, 'salva')),
    h('dl', { class: 'spec mono' },
      h('dt', {}, 'durata'), h('dd', {}, fmtDur(v.duration)),
      h('dt', {}, 'peso'), h('dd', {}, fmtSize(v.size)),
      h('dt', {}, 'file'), h('dd', {}, v.fileName || '—'),
      h('dt', {}, 'caricata'), h('dd', {}, `${fmtDay(v.addedAt)} ${fmtTime(v.addedAt)}`),
      h('dt', {}, 'sha-256'), h('dd', { class: 'small' }, v.hash)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { closeSheets(); play(v); } }, icon('play', 15), 'riproduci'),
      h('button', { class: 'btn', onclick: () => { closeSheets(); openAsk(t, v); } }, C.askOk),
      h('button', { class: 'btn ghost', onclick: () => copy(v.hash, 'impronta copiata.') }, 'copia impronta')),
    h('label', { class: 'lab mono' }, 'ok a mano (detto a voce, in studio…)'),
    h('div', { class: 'row' }, by, h('button', { class: 'btn', onclick: () => {
      const res = commit('ok a mano', () => applyOps(S, t.id, [{ action: 'approve', version: `v${v.n}`, by: by.value.trim() || '?', source: 'mano' }]));
      closeSheets();
      toast(res.done[0] || res.errors[0], { undo: res.done.length > 0 });
    } }, '✓ registra')),
    h('button', { class: 'btn danger wide', onclick: () => confirmSheet(`elimino la v${v.n}?`, 'anche i suoi ok. l’audio su questo dispositivo sparisce.', () => {
      const blob = commit('elimina versione', () => deleteVersion(S, v.id));
      if (blob) deleteAudio(blob).catch(() => {});
      if (player.vid === v.id) { player.audio.pause(); player.vid = null; render(); }
      toast(`v${v.n} eliminata.`, { undo: true });
    }) }, 'elimina versione'),
  ]);
}

function openSettings() {
  const name = h('input', { class: 'field', value: S.me.name, placeholder: 'come ti chiamano nelle chat', 'aria-label': 'il tuo nome', maxlength: 40 });
  const phone = h('input', { class: 'field', value: S.me.phone, type: 'tel', placeholder: '39 333 1234567', 'aria-label': 'il tuo numero whatsapp', maxlength: 20 });
  const preset = h('select', { class: 'field', 'aria-label': 'servizio ai' },
    h('option', { value: '' }, 'spenta · solo regole'),
    Object.entries(PRESETS).map(([k, p]) => h('option', { value: k, selected: S.ai.base === p.base ? true : null }, p.label)));
  const base = h('input', { class: 'field mono', value: S.ai.base, placeholder: 'https://…/v1', 'aria-label': 'indirizzo del servizio' });
  const model = h('input', { class: 'field mono', value: S.ai.model, placeholder: 'modello', 'aria-label': 'modello' });
  const key = h('input', { class: 'field mono', value: S.ai.key, type: 'password', placeholder: 'chiave api', 'aria-label': 'chiave api', autocomplete: 'off' });
  preset.addEventListener('change', () => { const p = PRESETS[preset.value]; base.value = p?.base || ''; model.value = p?.model || ''; });
  const backup = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  backup.addEventListener('change', async () => {
    try {
      const data = fromBackup(S, JSON.parse(await backup.files[0].text()));
      commit('importa backup', () => { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, data); });
      closeSheets();
      toast(`backup caricato: ${count(S.tracks.length)} brani. l’audio non viaggia nei backup.`, { undo: true });
    } catch { toast('backup non valido.'); }
  });
  const people = collaborators(S);
  sheet(C.settings, [
    h('div', { class: 'profile' }, avatar(S.me.name, { me: true, size: 64 }),
      h('div', {}, h('b', {}, S.me.name || 'tu'), h('span', { class: 'mono muted' }, `${count(S.tracks.length)} brani · ${count(people.length)} collaboratori`))),
    people.length ? h('ul', { class: 'people' }, people.map((p) => h('li', {}, avatar(p.name, { size: 28 }), h('span', {}, p.name), h('span', { class: 'mono muted' }, `${count(p.tracks)} brani`)))) : null,
    h('label', { class: 'lab mono' }, '01 tu'), name,
    h('label', { class: 'lab mono' }, '02 il tuo whatsapp · dove arrivano gli ok'), phone,
    h('label', { class: 'lab mono' }, '03 ai · facoltativa, legge solo testo'), preset, base, model, key,
    h('p', { class: 'muted small' }, 'gemini: chiave gratis su aistudio.google.com. ollama: gira sul tuo mac, niente esce. l’audio non viene mai mandato a nessuno.'),
    h('button', { class: 'btn primary wide', onclick: () => {
      commit('impostazioni', () => { S.me.name = name.value.trim(); S.me.phone = phone.value.trim(); S.ai = { base: base.value.trim(), model: model.value.trim(), key: key.value.trim(), consent: S.ai.consent || '' }; });
      closeSheets();
      toast('salvato.');
    } }, 'salva'),
    h('label', { class: 'lab mono' }, '04 dati'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: exportBackup }, 'esporta backup'),
      h('button', { class: 'btn', onclick: () => backup.click() }, 'importa backup'), backup,
      h('button', { class: 'btn ghost', onclick: () => (S.tracks.length ? confirmSheet('carico i dati finti?', 'prendono il posto dei tuoi brani. si può annullare subito dopo. l’audio dei tuoi brani resta qui finché non cancelli tutto. esporta un backup prima, se vuoi tenerli.', loadDemo) : loadDemo()) }, C.demo)),
    h('button', { class: 'btn danger wide', onclick: () => confirmSheet('cancello tutto?', 'brani, varianti, ok, registro e tutto l’audio su questo dispositivo. i brani tornano con annulla, l’audio no.', () => {
      commit('cancella tutto', () => { const keep = { me: S.me, ai: S.ai }; for (const k of Object.keys(S)) delete S[k]; Object.assign(S, emptyState(), keep); });
      player.audio.pause(); player.audio.removeAttribute('src'); player.vid = null;
      go('#/');
      clearAudio()
        .then(() => toast('tabula rasa. i brani tornano con annulla, l’audio no.', { undo: true }))
        .catch(() => toast('brani cancellati. l’audio non sono riuscito a cancellarlo: svuota i dati del sito dalle impostazioni del browser.', { undo: true }));
    }) }, 'cancella tutto'),
    h('details', { class: 'fold' }, h('summary', { class: 'lab mono' }, '05 privacy'),
      h('ul', { class: 'privacy small' }, C.privacy.map((p) => h('li', {}, p)))),
    h('p', { class: 'mono muted small foot' }, 'tempo studio · v0.2 · dati solo su questo dispositivo'),
  ]);
}

/** Dati finti al posto dei brani, tenendo nome, numero e impostazioni dell'ai. */
function loadDemo() {
  commit('demo', () => { const keep = { me: S.me.name ? S.me : demoState().me, ai: S.ai }; Object.assign(S, demoState(), keep); });
  closeSheets();
  go('#/');
  toast('dati finti caricati.', { undo: true });
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(S, (k, v) => (k === 'key' ? '' : v), 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `tempo-studio-${dateKey(Date.now())}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('backup esportato. la chiave ai resta qui.');
}

// ---------------------------------------------------------------- componenti
function topbar(left, right) {
  return h('header', { class: 'topbar' }, h('div', { class: 'tb-l' }, left), h('div', { class: 'tb-r' }, right));
}
function iconBtn(name, label, onclick, extra = '') {
  return h('button', { class: `icon-btn ${extra}`, 'aria-label': label, title: label, onclick }, icon(name, extra === 'small' ? 16 : 18));
}

function sheet(title, kids) {
  closeSheets(true);
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', { class: 'sheet-title' }, title), iconBtn('x', 'chiudi', closeSheets)),
    h('div', { class: 'sheet-body' }, kids));
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) closeSheets(); } }, panel);
  $sheets.append(wrap);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => { wrap.classList.add('in'); if (!panel.contains(document.activeElement)) panel.querySelector('.sheet-head .icon-btn')?.focus({ preventScroll: true }); });
  return panel;
}
// uscita più corta e piccola dell'entrata; istantanea quando un foglio ne sostituisce un altro
function closeSheets(instant = false) {
  document.body.classList.remove('sheet-open');
  const wraps = [...$sheets.children];
  if (!wraps.length) return;
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { $sheets.replaceChildren(); return; }
  wraps.forEach((w) => { w.classList.remove('in'); w.classList.add('out'); });
  setTimeout(() => wraps.forEach((w) => w.remove()), 220);
}
function confirmSheet(q, detail, yes) {
  sheet(q, [h('p', { class: 'muted' }, detail), h('div', { class: 'row' },
    h('button', { class: 'btn danger', onclick: () => { closeSheets(); yes(); } }, 'sì, procedi'),
    h('button', { class: 'btn ghost', onclick: closeSheets }, 'no'))]);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

let toastTimer = null;
function toast(text, { undo: withUndo = false, sticky = false } = {}) {
  clearTimeout(toastTimer);
  $toast.replaceChildren(h('span', {}, text));
  if (withUndo && canUndo()) $toast.append(h('button', { class: 'link', onclick: () => {
    const label = undo(S);
    save(S);
    render();
    toast(label ? `annullato: ${label}.` : 'niente da annullare.');
  } }, C.undo));
  $toast.classList.add('in');
  if (!sticky) toastTimer = setTimeout(hideToast, withUndo ? 6000 : 3200);
}
function hideToast() { $toast.classList.remove('in'); }

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('non posso copiare qui. seleziona e copia a mano.'); }
}

// ---------------------------------------------------------------- avvio
render();
persistStorage(); // l'audio sta solo qui: chiedi di non sfrattarlo

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
}
