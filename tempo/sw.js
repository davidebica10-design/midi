// Cache dell'app per l'uso offline. Aggiorna VERSION a ogni rilascio.
const VERSION = 'tempo-v24';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/scheduler.js', 'js/store.js', 'js/ai.js', 'js/ai-open.js', 'js/images.js', 'js/companion.js', 'js/parse.js', 'js/templates.js', 'js/goals.js', 'js/learn.js', 'js/viewmodel.js', 'js/format.js', 'js/motion.js', 'js/themes.js', 'js/focus.js',
  'vendor/anthropic-sdk.mjs',
  'icons/ui/plus.svg', 'icons/ui/mic.svg', 'icons/ui/arrow-up.svg', 'icons/ui/arrow-left.svg', 'icons/ui/notepad-text.svg', 'icons/ui/grid-2x2.svg',
  'icons/ui/file-text.svg', 'icons/ui/arrow-up-right.svg', 'icons/ui/circle-check.svg', 'icons/ui/circle.svg', 'icons/ui/newspaper.svg', 'icons/ui/x.svg', 'icons/ui/camera.svg', 'icons/ui/rotate-ccw.svg', 'icons/ui/arrow-right.svg',
  'icons/act/airplane-tilt.svg', 'icons/act/barbell.svg', 'icons/act/bicycle.svg', 'icons/act/book-open-text.svg', 'icons/act/book.svg', 'icons/act/brain.svg', 'icons/act/briefcase.svg', 'icons/act/broom.svg', 'icons/act/cake.svg', 'icons/act/camera.svg', 'icons/act/car.svg', 'icons/act/code.svg', 'icons/act/coffee.svg', 'icons/act/confetti.svg', 'icons/act/credit-card.svg', 'icons/act/dog.svg', 'icons/act/envelope-simple.svg', 'icons/act/exam.svg', 'icons/act/film-slate.svg', 'icons/act/flag.svg', 'icons/act/flower-lotus.svg', 'icons/act/fork-knife.svg', 'icons/act/game-controller.svg', 'icons/act/graduation-cap.svg', 'icons/act/guitar.svg', 'icons/act/headphones.svg', 'icons/act/heart.svg', 'icons/act/house.svg', 'icons/act/island.svg', 'icons/act/lightbulb.svg', 'icons/act/microphone-stage.svg', 'icons/act/moon.svg', 'icons/act/music-notes.svg', 'icons/act/paint-brush.svg', 'icons/act/palette.svg', 'icons/act/pencil-simple-line.svg', 'icons/act/person-simple-run.svg', 'icons/act/person-simple-swim.svg', 'icons/act/person-simple-tai-chi.svg', 'icons/act/person-simple-walk.svg', 'icons/act/phone.svg', 'icons/act/pill.svg', 'icons/act/plant.svg', 'icons/act/shopping-cart.svg', 'icons/act/soccer-ball.svg', 'icons/act/sparkle.svg', 'icons/act/stethoscope.svg', 'icons/act/timer.svg', 'icons/act/tooth.svg', 'icons/act/users-three.svg', 'icons/act/video-camera.svg', 'icons/act/washing-machine.svg', 'icons/act/wrench.svg',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rete prima (così gli aggiornamenti arrivano subito), cache se offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: chiede sempre al server la versione più recente (il server risponde 304 se non è cambiata)
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
