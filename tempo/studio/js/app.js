// tempo studio: interfaccia. Libreria di brani → brano (versioni, ok, adesso, registro) → pagina ok per l'artista.
import {
  load, save, saveFailed, snapshot, undo, canUndo, sanitizeState, emptyState, demoState, STAGES,
  trackOf, versionsOf, latestVersion, approvalsOf, openTasks, logOf, statusOf, findByHash, approvedVersion,
  addTrack, deleteTrack, addVersion, deleteVersion, setStage, toggleTask, renameTrack, applyOps,
  snapshotOf, changesSince, markShared,
} from './store.js';
import { h, fmtDur, fmtDay, fmtTime, fmtDue, fmtSize, fmtPrint, extOf, count, dateKey } from './util.js';
import { sha256 } from './hash.js';
import { putAudio, deleteAudio, audioUrl, analyze } from './audio.js';
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
  const m = location.hash.match(/^#\/(t|ok|s)\/(.+)$/);
  return m ? { name: m[1], arg: decodeURIComponent(m[2]) } : { name: 'lib' };
}
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else render(); };

function render() {
  const r = route();
  document.body.dataset.route = r.name;
  $app.replaceChildren();
  if (saveFailed()) $app.append(h('div', { class: 'alert', role: 'alert' }, C.saveFail));
  // il dock sta fuori dalla vista: l'animazione d'entrata usa transform, che romperebbe position: fixed
  if (r.name === 't' && trackOf(S, r.arg)) $app.append(trackView(trackOf(S, r.arg)), dock(trackOf(S, r.arg)));
  else if (r.name === 'ok') $app.append(artistView(r.arg));
  else if (r.name === 's') $app.append(snapView(r.arg));
  else $app.append(libraryView());
  renderPlayer();
}

window.addEventListener('hashchange', () => { closeSheets(); render(); window.scrollTo(0, 0); });

// ---------------------------------------------------------------- libreria
function libraryView() {
  const open = S.tasks.filter((t) => !t.done).length;
  const waiting = S.tracks.filter((t) => statusOf(S, t.id).kind === 'attesa').length;
  return h('main', { class: 'view lib' },
    topbar([h('div', { class: 'brand' }, h('b', {}, C.brand), h('span', {}, C.sub))], [iconBtn('more', C.settings, openSettings)]),
    h('h1', { class: 'big' }, C.library, h('sup', { class: 'mono' }, count(S.tracks.length))),
    S.tracks.length
      ? h('p', { class: 'lede mono' }, `${count(waiting)} senza ok · ${count(open)} cose aperte`)
      : h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, C.emptyTitle),
        h('p', { class: 'muted' }, C.emptyBody),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: openNewTrack }, C.newTrack),
          h('button', { class: 'btn ghost', onclick: () => { commit('demo', () => Object.assign(S, demoState())); toast('dati finti caricati. niente audio, solo forma.'); } }, C.demo))),
    S.tracks.length ? h('div', { class: 'grid' },
      S.tracks.map(tile),
      h('button', { class: 'tile tile-new', onclick: openNewTrack, 'aria-label': C.newTrack },
        h('span', { class: 'cover new' }, h('span', { class: 'plus' }, '+')),
        h('span', { class: 'tile-title' }, C.newTrack),
        h('span', { class: 'tile-meta mono' }, 'vuoto, per ora'))) : null,
  );
}

function tile(t) {
  const st = statusOf(S, t.id);
  return h('button', { class: 'tile', onclick: () => go(`#/t/${t.id}`) },
    h('span', { class: 'cover' }, cover(t.id),
      st.kind === 'ok' ? h('span', { class: 'badge ok mono' }, '✓ ok') : st.kind === 'attesa' ? h('span', { class: 'badge wait mono' }, '○ attesa') : null),
    h('span', { class: 'tile-title' }, t.title),
    h('span', { class: 'tile-meta mono' }, `${t.artist || '—'} · ${stageNum(t.stage)} ${STAGES[t.stage]}`));
}

// ---------------------------------------------------------------- brano
function trackView(t) {
  const versions = versionsOf(S, t.id);
  const last = versions[0];
  const st = statusOf(S, t.id);
  const tasks = openTasks(S, t.id);

  const view = h('main', { class: 'view track' },
    topbar([h('button', { class: 'crumb mono', onclick: () => go('#/') }, icon('back', 16), C.back)], [iconBtn('more', 'opzioni brano', () => openTrackMenu(t))]),
    h('section', { class: 'hero' },
      h('div', { class: 'cover hero-cover' }, cover(t.id)),
      h('div', { class: 'hero-text' },
        h('p', { class: 'mono muted' }, `brano · ${stageNum(t.stage)} ${STAGES[t.stage]}`),
        h('h1', { class: 'title' }, t.title),
        h('p', { class: 'muted' }, t.artist ? `con ${t.artist}` : 'da solo, per ora', ` · dal ${fmtDay(t.createdAt)}`),
        h('div', { class: 'row actions' },
          h('button', { class: 'btn light play-btn', disabled: !last, onclick: () => last && play(last) }, icon('play', 16), C.listen),
          h('button', { class: 'btn', disabled: !last, onclick: () => last && openAsk(t, last) }, C.askOk),
          h('button', { class: 'btn', onclick: () => pickAudio(t.id) }, C.addBounce)))),

    h('nav', { class: 'stages', 'aria-label': 'fase del brano' },
      STAGES.map((name, i) => h('button', {
        class: `stage${i === t.stage ? ' on' : ''}${i < t.stage ? ' past' : ''}`, 'aria-pressed': String(i === t.stage),
        onclick: () => commit('fase', () => setStage(S, t.id, i)),
      }, h('span', { class: 'mono' }, stageNum(i)), h('span', {}, name)))),

    block('01', C.now, [
      st.ok ? h('p', { class: 'okline' }, h('span', { class: 'dot ok' }), `v${st.ok.version.n} approvata da ${st.ok.approval.by || '?'} · ${fmtDay(st.ok.approval.at)} ${fmtTime(st.ok.approval.at)}`, h('span', { class: 'mono muted' }, `  #${fmtPrint(st.ok.version.hash)}`))
        : h('p', { class: 'okline muted' }, h('span', { class: 'dot' }), last ? 'nessun ok ancora.' : 'niente da approvare.'),
      st.ok && last && st.ok.version.id !== last.id ? h('p', { class: 'okline warn' }, h('span', { class: 'dot warn' }), `v${last.n} è più nuova dell’ok. chiedi di nuovo?`, ' ', h('button', { class: 'link', onclick: () => openAsk(t, last) }, `chiedi ok su v${last.n}`)) : null,
      tasks.length ? h('ul', { class: 'tasks' }, tasks.map((k) => taskRow(k))) : h('p', { class: 'muted' }, C.nothingOpen),
      h('button', { class: 'link', onclick: () => openTask(t) }, C.addTask),
    ]),

    block('02', C.versions, [
      versions.length ? h('ol', { class: 'versions' }, versions.map((v) => versionRow(t, v))) : h('p', { class: 'muted dropnote' }, C.noVersions),
    ]),

    block('03', C.tools, [
      h('div', { class: 'tools' },
        h('button', { class: 'tool', onclick: () => openImport(t) }, h('b', {}, C.importChat), h('span', { class: 'muted' }, 'ok, richieste e scadenze dalla chat')),
        h('button', { class: 'tool', onclick: () => pickVerify() }, h('b', {}, C.verify), h('span', { class: 'muted' }, 'è il file approvato? sì o no'))),
    ]),

    block('04', C.log, [
      h('ol', { class: 'log mono' }, logOf(S, t.id).slice(0, 40).map((l) => logRow(l, !!t.sharedAt && l.at > t.sharedAt))),
      t.sharedAt ? h('p', { class: 'mono muted small' }, `ultimo link condiviso: ${fmtDay(t.sharedAt)} ${fmtTime(t.sharedAt)}. evidenziato quello che è cambiato dopo.`) : null,
    ]),
  );

  // trascina un file sulla pagina del brano → nuova versione
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

function versionRow(t, v) {
  const oks = approvalsOf(S, v.id);
  const playing = player.vid === v.id;
  return h('li', { class: `vrow${playing ? ' playing' : ''}${oks.length ? ' ok' : ''}` },
    h('button', { class: 'vmain', onclick: () => play(v), 'aria-label': `riproduci v${v.n}` },
      h('span', { class: 'vn mono' }, `v${v.n}`),
      h('span', { class: 'vbody' },
        h('span', { class: 'vname' }, v.fileName || `versione ${v.n}`),
        h('span', { class: 'vmeta mono' }, [fmtDur(v.duration), extOf(v.fileName) || 'audio', fmtSize(v.size), `#${fmtPrint(v.hash)}`].join(' · ')),
        wave(v.peaks, playing))),
    h('span', { class: 'vside' },
      oks.length ? h('span', { class: 'chip ok mono', title: oks.map((a) => `${a.by} · ${fmtDay(a.at)}`).join('\n') }, `✓ ${oks[0].by || 'ok'}`)
        : h('button', { class: 'chip mono', onclick: () => openAsk(t, v) }, 'chiedi ok'),
      iconBtn('more', `opzioni v${v.n}`, () => openVersionMenu(t, v), 'small')));
}

function wave(peaks, on) {
  const list = peaks?.length ? peaks : Array.from({ length: 48 }, () => 0.12);
  return h('span', { class: `wave${on ? ' on' : ''}`, 'aria-hidden': 'true' }, list.map((p) => h('i', { style: `height:${Math.max(8, Math.round(p * 100))}%` })));
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
    body = `${f.name} è la v${hit.version.n} di «${hit.track.title}», approvata da ${hit.approval.by || '?'} il ${fmtDay(hit.approval.at)} alle ${fmtTime(hit.approval.at)}.`;
  } else if (hit) {
    const ok = approvedVersion(S, hit.track.id);
    head = h('p', { class: 'verdict warn' }, '○ conosciuto, non approvato.');
    body = `è la v${hit.version.n} di «${hit.track.title}». ${ok ? `l’ok ce l’ha la v${ok.version.n}.` : 'nessuna versione ha ancora un ok.'}`;
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
      h('button', { class: 'pl-cover', onclick: () => go(`#/t/${t.id}`), 'aria-label': `apri ${t.title}` }, cover(t.id)),
      h('div', { class: 'pl-text' }, h('b', {}, t.title), h('span', { class: 'mono muted' }, `v${v.n} · `, h('span', { class: 'pl-time' }, '0:00'), ` / ${fmtDur(v.duration)}`)),
      h('button', { class: 'pl-btn', 'aria-label': 'riproduci', onclick: () => (player.audio.paused ? player.audio.play() : player.audio.pause()) }, h('span', { class: 'swap' }, icon('play', 18), icon('pause', 18)))));
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
    h('p', { class: 'muted' }, 'mandi un link. chi lo apre ascolta, tocca approvo, e la risposta torna su whatsapp con un codice. tu importi la chat: ok registrato, legato a questa impronta.'),
    h('label', { class: 'lab mono' }, 'link di ascolto · facoltativo'),
    audio,
    h('p', { class: 'muted small' }, 'il file non parte da qui. oppure mandalo su whatsapp come sempre.'),
    !S.me.phone ? h('p', { class: 'warnbox small' }, 'senza il tuo numero (impostazioni) la risposta chiede a chi mandarla.') : null,
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
      h('span', {}, t.artist ? `condividi con ${t.artist}` : 'condividi'),
      news ? h('span', { class: 'dock-badge mono' }, `${count(news)} novità`) : null));
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
    h('p', { class: 'muted' }, `un link con lo stato di «${t.title}». si apre dal telefono, senza account. ${t.artist || 'chi lo riceve'} vede versioni, ok, cose da fare e cosa è cambiato dall’ultima volta.`),
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
    h('p', { class: 'muted small foot' }, 'è una foto di adesso: non si aggiorna da sola. quando cambia qualcosa, condividi di nuovo. niente server: tutto sta nel link.'),
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
        h('p', { class: 'mono muted small' }, `foto del ${fmtDay(sn.at)} alle ${fmtTime(sn.at)}`))),
    h('div', { class: 'stages ro', role: 'img', 'aria-label': `fase ${stageNum(sn.stage)} di 06: ${STAGES[sn.stage]}` },
      STAGES.map((name, i) => h('span', { class: `stage${i === sn.stage ? ' on' : ''}${i < sn.stage ? ' past' : ''}` }, h('span', { class: 'mono' }, stageNum(i)), h('span', {}, name)))),
    news.length ? h('section', { class: 'block news' },
      h('h2', { class: 'label mono' }, h('span', {}, '◆'), ` ${count(news.length)} novità dall’ultimo link`),
      h('ol', { class: 'log mono' }, news.map((l) => logRow(l, true)))) : null,
    block('01', C.now, [
      ok ? h('p', { class: 'okline' }, h('span', { class: 'dot ok' }), `v${ok.n} approvata${ok.okBy ? ` da ${ok.okBy}` : ''}${ok.okAt ? ` · ${fmtDay(ok.okAt)}` : ''}`)
        : h('p', { class: 'okline muted' }, h('span', { class: 'dot' }), last ? 'nessun ok ancora.' : 'niente da approvare.'),
      ok && last && ok.n !== last.n ? h('p', { class: 'okline warn' }, h('span', { class: 'dot warn' }), `v${last.n} è più nuova dell’ok.`) : null,
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
  sheet(`v${v.n} · ${v.fileName}`, [
    h('dl', { class: 'spec mono' },
      h('dt', {}, 'durata'), h('dd', {}, fmtDur(v.duration)),
      h('dt', {}, 'peso'), h('dd', {}, fmtSize(v.size)),
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
      const data = sanitizeState(JSON.parse(await backup.files[0].text()));
      commit('importa backup', () => { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, data); });
      closeSheets();
      toast(`backup caricato: ${count(S.tracks.length)} brani. l’audio non viaggia nei backup.`, { undo: true });
    } catch { toast('backup non valido.'); }
  });
  sheet(C.settings, [
    h('label', { class: 'lab mono' }, '01 tu'), name,
    h('label', { class: 'lab mono' }, '02 il tuo whatsapp · dove arrivano gli ok'), phone,
    h('label', { class: 'lab mono' }, '03 ai · facoltativa, legge solo testo'), preset, base, model, key,
    h('p', { class: 'muted small' }, 'gemini: chiave gratis su aistudio.google.com. ollama: gira sul tuo mac, niente esce. l’audio non viene mai mandato a nessuno.'),
    h('button', { class: 'btn primary wide', onclick: () => {
      commit('impostazioni', () => { S.me.name = name.value.trim(); S.me.phone = phone.value.trim(); S.ai = { base: base.value.trim(), model: model.value.trim(), key: key.value.trim() }; });
      closeSheets();
      toast('salvato.');
    } }, 'salva'),
    h('label', { class: 'lab mono' }, '04 dati'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: exportBackup }, 'esporta backup'),
      h('button', { class: 'btn', onclick: () => backup.click() }, 'importa backup'), backup,
      h('button', { class: 'btn ghost', onclick: () => { commit('demo', () => Object.assign(S, demoState())); closeSheets(); go('#/'); toast('dati finti caricati.', { undo: true }); } }, C.demo)),
    h('button', { class: 'btn danger wide', onclick: () => confirmSheet('cancello tutto?', 'brani, versioni, ok e registro. l’audio resta finché non svuoti i dati del sito.', () => {
      commit('cancella tutto', () => { const keep = { me: S.me, ai: S.ai }; for (const k of Object.keys(S)) delete S[k]; Object.assign(S, emptyState(), keep); });
      go('#/');
      toast('tabula rasa.', { undo: true });
    }) }, 'cancella tutto'),
    h('p', { class: 'mono muted small foot' }, 'tempo studio · v0.1 · dati solo su questo dispositivo'),
  ]);
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

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
}
