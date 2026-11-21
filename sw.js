/* GDX service worker — makes gdxgarage.com installable and usable offline.
 * Pages, CSS and JS: network first (always the latest version when online), saved copy when offline.
 * Images and the Supabase library: saved copy first (fast), refreshed in the background.
 * Supabase data, logins and payments are never cached — they always go to the network.
 * After a site update, bump VERSION so old saved files are cleared. */
const VERSION = 'gdx-v1';
const CORE = [
  '/', '/index.html', '/shop.html', '/auction.html', '/giveaway.html', '/race.html', '/partners.html',
  '/offline.html', '/manifest.webmanifest',
  '/assets/css/theme.css', '/assets/css/gdx.css',
  '/assets/js/config.js', '/assets/js/logo.js', '/assets/js/app.js',
  '/assets/img/icon-192.png', '/assets/img/logo-192.png', '/assets/img/favicon-32.png'
];
const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled([...CORE, SB_LIB].map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && res.ok && res.type !== 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // never touch Supabase (data, sign-in, storage uploads), Google sign-in or anything else off-site
  if (url.origin !== location.origin && req.url !== SB_LIB && !url.hostname.endsWith('fonts.gstatic.com') && !url.hostname.endsWith('fonts.googleapis.com')) return;
  // a sign-in return (?code=…) must always reach the page fresh
  if (url.searchParams.has('code') || url.searchParams.has('error_description')) return;

  // pages: network first, saved copy offline, then the offline page
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => put(req, res)).catch(() =>
      caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/offline.html'))));
    return;
  }
  const isAsset = /\.(css|js|webmanifest)$/.test(url.pathname) && url.origin === location.origin;
  if (isAsset) {   // CSS/JS: network first so a new upload shows straight away
    e.respondWith(fetch(req).then(res => put(req, res)).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // images, fonts, the pinned Supabase library: saved copy first, refresh in the background
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => put(req, res)).catch(() => hit);
    return hit || net;
  }));
});
