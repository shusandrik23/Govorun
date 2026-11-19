// Мост к Android (Capacitor) и показ ошибок на экране.
// js/vendor/capacitor.js (из @capacitor/core) добавляет в window.Capacitor функцию registerPlugin —
// без неё нативные плагины недоступны. В браузере этого файла может не быть, тогда плагины просто не используются.
(function () {
  // Если приложение упадёт, показываем текст ошибки вместо пустого экрана.
  function showError(msg) {
    try {
      let box = document.getElementById('crash');
      if (!box) {
        box = document.createElement('div');
        box.id = 'crash';
        box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:90px;z-index:99;background:#FFDFE0;color:#C62828;' +
          'border:2px solid #FF4B4B;border-radius:14px;padding:12px 14px;font:700 13px/1.4 sans-serif;white-space:pre-wrap;word-break:break-word';
        (document.body || document.documentElement).appendChild(box);
      }
      box.textContent = 'Ошибка приложения — пришлите скриншот разработчику:\n' + String(msg).slice(0, 600);
    } catch (e) { /* ничего не поделать */ }
  }
  window.addEventListener('error', (e) => showError((e.message || 'error') + (e.filename ? `\n${e.filename.split('/').pop()}:${e.lineno}` : '')));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // Отказы нативных плагинов (нет сети, пользователь закрыл меню «Поделиться») — не повод пугать пользователя.
    if (r && (r.code || /cancel/i.test(String(r.message || r)))) return;
    showError('Promise: ' + (r && (r.stack || r.message) || r));
  });

  const cap = window.Capacitor;
  let isNative = false;
  try { isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()); } catch (e) { isNative = false; }
  const cache = {};

  window.Native = {
    isNative,
    has(name) {
      try { return isNative && !!(cap.PluginHeaders || []).some((p) => p.name === name); } catch (e) { return false; }
    },
    // Объект плагина или null. ВАЖНО: результат нельзя «ждать» через await — объект плагина притворяется обещанием.
    plugin(name) {
      if (cache[name] !== undefined) return cache[name];
      let p = null;
      try { if (this.has(name) && typeof cap.registerPlugin === 'function') p = cap.registerPlugin(name); } catch (e) { p = null; }
      cache[name] = p;
      return p;
    },
  };
})();
