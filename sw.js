/* 걸어서 그날까지 · 서비스 워커
   앱 껍데기는 미리 저장하고, 지도 타일은 보던 곳만 조금 저장합니다. */
const VERSION = "walk-v1";
const SHELL_CACHE = VERSION + "-shell";
const TILE_CACHE = VERSION + "-tiles";
const CDN_CACHE = VERSION + "-cdn";
const TILE_LIMIT = 180;

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./routes.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png",
  "./icons/favicon-32.png",
  "./og-image.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => { })
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimCache(name, max) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  } catch (e) { /* 무시 */ }
}

function isTile(url) {
  return /tile\.openstreetmap\.org|server\.arcgisonline\.com/.test(url.hostname);
}
function isCdn(url) {
  return /unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname);
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  /* 화면(문서) 요청: 네트워크 우선, 4초 안에 안 되면 저장해 둔 화면 */
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const fresh = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))
        ]);
        if (fresh && fresh.ok) cache.put("./index.html", fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match(req)) || (await cache.match("./index.html")) || (await cache.match("./")) ||
          new Response("<h1>걸어서 그날까지</h1><p>오프라인이에요. 인터넷이 연결되면 다시 열어 주세요.</p>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  /* 지도 타일: 저장된 것 먼저, 없으면 받아서 저장 */
  if (isTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) {
          cache.put(req, res.clone());
          trimCache(TILE_CACHE, TILE_LIMIT);
        }
        return res;
      } catch (e) {
        return hit || Response.error();
      }
    })());
    return;
  }

  /* CDN(Leaflet·폰트)과 같은 출처 파일: 저장본 먼저 보여주고 뒤에서 갱신 */
  if (isCdn(url) || url.origin === self.location.origin) {
    event.respondWith((async () => {
      const name = isCdn(url) ? CDN_CACHE : SHELL_CACHE;
      const cache = await caches.open(name);
      const hit = await cache.match(req, { ignoreSearch: false });
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) return hit;
      const res = await network;
      if (res) return res;
      return new Response("", { status: 504, statusText: "offline" });
    })());
    return;
  }
});
