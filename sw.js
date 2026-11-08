/* سرویس‌ورکر: بعد از اولین ورود، سایت روی گوشی ذخیره می‌شود و بدون اینترنت هم باز می‌شود.
   برای انتشار نسخه‌ی جدید، فقط شماره‌ی VERSION را عوض کن. */
var VERSION = 'v2';
var STATIC = 'raisi-static-' + VERSION;
var DATA = 'raisi-data-' + VERSION;
var CORE = ['./', 'index.html', 'style.css', 'script.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
var CDN = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(STATIC).then(function (c) {
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== STATIC && k !== DATA; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, cacheName, fallbackUrl) {
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(cacheName).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (m) { return m || (fallbackUrl ? caches.match(fallbackUrl) : Response.error()); });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(STATIC).then(function (c) {
    return c.match(req).then(function (m) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
        return res;
      }).catch(function () { return m; });
      return m || net;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;           // نوشتن در سرور (مدیریت) هرگز دستکاری نمی‌شود
  var url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.indexOf('/sb/auth') === 0) return;          // ورود مدیر: بدون کش
    if (url.pathname.indexOf('/sb/') === 0) {                    // داده‌ی سایت: اول اینترنت، بعد نسخه‌ی ذخیره‌شده
      e.respondWith(networkFirst(req, DATA));
      return;
    }
    if (req.mode === 'navigate') {                               // خود صفحه: همیشه تازه‌ترین، آفلاین از کش
      e.respondWith(networkFirst(req, STATIC, './'));
      return;
    }
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (CDN.indexOf(url.hostname) !== -1) e.respondWith(staleWhileRevalidate(req));
});
