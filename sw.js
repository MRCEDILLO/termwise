// Keeps a copy of the website's own files (and the Firebase and font files it loads), so
// Termwise still opens on bad or no Wi-Fi. Always tries the network first, so a new version
// shows up straight away; the saved copy is only used when the network fails or takes more
// than a few seconds. Class data is not stored here: Firestore keeps its own offline copy.

const CACHE = 'termwise-v1';
const WAIT_MS = 4000;
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'files.js', 'keys.js', 'planner.js',
  'template.js', 'tracker.js', 'firebase.js', 'demo.js', 'favicon.svg'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Which requests get a saved copy: this site's files, the pinned Firebase SDK, and fonts.
function cacheable(url) {
  if (url.origin === self.location.origin) return true;
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return true;
  return url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!cacheable(url)) return;
  ev.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  const fromNet = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  fromNet.catch(() => {}); // a failure is handled below; this stops an "unhandled" warning
  const slow = new Promise((resolve) => setTimeout(resolve, WAIT_MS, null));
  const first = await Promise.race([fromNet.catch(() => null), slow]);
  if (first) return first;
  // The page itself is saved as ./ and index.html; any URL on this site with a #route uses it.
  const saved = await cache.match(req, { ignoreSearch: url.origin === self.location.origin })
    || (req.mode === 'navigate' ? await cache.match('./') || await cache.match('index.html') : null);
  return saved || fromNet;
}
