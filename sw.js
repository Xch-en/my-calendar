/* 我的日程 - Service Worker：预缓存应用外壳，离线可用 */
'use strict';

// 修改任何静态文件后，把版本号 +1，用户下次打开时自动更新缓存
const CACHE_VERSION = 'my-calendar-v11';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './lib/fullcalendar.global.min.js',
  './lib/fullcalendar.zh-cn.min.js',
  './lib/dexie.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* 安装：预缓存全部外壳资源，完成后立即接管页面。
   用 cache:'reload' 强制绕过 HTTP 缓存，确保每次安装都拿到磁盘最新文件 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.all(APP_SHELL.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
      )))
      .then(() => self.skipWaiting())
  );
});

/* 激活：清掉旧版本缓存 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 请求：缓存优先；未命中的同源 GET 顺手回填缓存，离线时导航回退到首页 */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
