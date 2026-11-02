/*
 * PocketLedger service worker.
 *
 *  - The offline app (/offline) and every asset it needs are precached, so the app opens
 *    with no connection — in the browser and as an installed app. The offline app reads the
 *    ledger from IndexedDB; this worker never caches financial pages or API data.
 *  - Online, pages always come from the network. When the network is unavailable — or the
 *    connection is "up" but the server doesn't answer in time (weak mobile data, Wi-Fi
 *    without internet) — any page opens the offline app at the matching screen
 *    (/offline?from=<page>). In-app page loads (RSC requests) get the same time limit, so
 *    the router falls back to a full page load, which then opens the offline app.
 *  - Content-hashed build assets are cached as they are used (cache-first).
 *  - The page asks the worker to refresh the offline app after each online visit
 *    ({type: "CACHE_SHELL"}), so it always matches the latest deployment.
 */
const VERSION = "v3";
const STATIC_CACHE = `pl-static-${VERSION}`;
const SHELL_URL = "/offline";
const ALWAYS = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/apple-icon.png", "/icon.png"];

/** Every /_next/static asset referenced by a document or stylesheet. */
function assetUrls(text) {
  const found = new Set();
  const cleaned = text.replace(/\\\//g, "/");
  const re = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[A-Za-z0-9_\-./~%@]+?\.(?:js|css|woff2?|ttf|png|svg|jpg|webp)/g;
  for (const m of cleaned.matchAll(re)) found.add(m[0].startsWith("/_next/") ? m[0] : `/_next/${m[0]}`);
  return [...found];
}

async function cacheShell() {
  const cache = await caches.open(STATIC_CACHE);
  const res = await fetch(SHELL_URL, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(SHELL_URL, res);
  const assets = assetUrls(html);
  // Fonts are referenced from the stylesheets, not the HTML.
  for (const css of assets.filter((u) => u.endsWith(".css"))) {
    try {
      const r = await fetch(css);
      if (r.ok) {
        await cache.put(css, r.clone());
        for (const u of assetUrls(await r.text())) assets.push(u);
      }
    } catch {
      /* next visit will retry */
    }
  }
  const missing = [];
  for (const u of new Set(assets)) if (!(await cache.match(u))) missing.push(u);
  await Promise.allSettled([...ALWAYS, ...missing].map((u) => cache.add(new Request(u, { cache: "reload" }))));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pl-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CACHE_SHELL") event.waitUntil(cacheShell().catch(() => undefined));
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(?:png|svg|ico|woff2?)$/.test(url.pathname);
}

/** Time limits for the server to answer. Shorter right after a failure, so offline is detected quickly. */
const NAV_TIMEOUT = 8000;
const NAV_TIMEOUT_AFTER_FAILURE = 2500;
let lastFailure = 0;

/** fetch that gives up after `ms` (the request itself can't be aborted for navigations). */
function fetchWithin(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      lastFailure = Date.now();
      reject(new Error("No answer from the server"));
    }, ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        lastFailure = 0;
        resolve(response);
      },
      (err) => {
        clearTimeout(timer);
        lastFailure = Date.now();
        reject(err);
      },
    );
  });
}
const pageTimeout = () => (Date.now() - lastFailure < 60_000 ? NAV_TIMEOUT_AFTER_FAILURE : NAV_TIMEOUT);

function isRscRequest(request, url) {
  return url.searchParams.has("_rsc") || request.headers.get("RSC") === "1";
}

async function shellResponse() {
  return (await caches.match(SHELL_URL, { ignoreSearch: true })) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetchWithin(request, pageTimeout()).catch(async () => {
        // No connection: open the offline app at the screen the user asked for.
        if (url.pathname === SHELL_URL) return shellResponse();
        const from = url.pathname + url.search;
        return Response.redirect(`${SHELL_URL}?from=${encodeURIComponent(from)}`, 302);
      }),
    );
    return;
  }

  if (isRscRequest(request, url)) {
    event.respondWith(fetchWithin(request, pageTimeout()).catch(() => Response.error()));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
