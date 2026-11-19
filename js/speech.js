// Распознавание русской речи без платных сервисов.
// В Android-приложении — встроенный распознаватель телефона (плагин @capacitor-community/speech-recognition),
// в браузере — Web Speech API (Chrome, Safari). Интерфейс один: Speech.create().start(onText) / stop().
(function () {
  const isNative = window.Native.isNative;
  const nativeSR = window.Native.plugin('SpeechRecognition');
  const WebSR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let nativeAvailable = null; // выясняется асинхронно

  async function checkAvailable() {
    if (nativeSR) {
      if (nativeAvailable === null) {
        try { nativeAvailable = !!(await nativeSR.available()).available; } catch (e) { nativeAvailable = false; }
      }
      return nativeAvailable;
    }
    return !!WebSR;
  }

  async function ensurePermission() {
    if (!nativeSR) return true; // браузер спросит сам
    try {
      let st = await nativeSR.checkPermissions();
      if (st.speechRecognition !== 'granted') st = await nativeSR.requestPermissions();
      return st.speechRecognition === 'granted';
    } catch (e) {
      return false;
    }
  }

  // ---- Android: распознаватель телефона. Он сам останавливается после паузы, поэтому перезапускаем его,
  // пока пользователь не нажал «стоп», а распознанное накапливаем.
  function nativeListener() {
    let active = false;
    let committed = ''; // фразы прошлых сессий распознавания
    let current = '';   // текущая фраза (промежуточный или окончательный текст)
    let onText = null;
    let handles = [];
    let restartTimer = null;
    let lastResultAt = 0;

    const emit = () => onText && onText((committed + ' ' + current).trim());
    const commit = () => { if (current) { committed = (committed + ' ' + current).trim(); current = ''; } };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // ВАЖНО: обещания плагина не всегда завершаются (stop() в плагине вообще не вызывает resolve),
    // поэтому никогда не ждём их без ограничения по времени.
    const settle = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), wait(ms)]);

    async function begin() {
      if (!active) return;
      // Окончательный текст прошлой фразы приходит уже ПОСЛЕ события «stopped», поэтому сохраняем фразу
      // только сейчас, перед новой сессией.
      commit();
      try {
        await nativeSR.start({ language: 'ru-RU', maxResults: 1, partialResults: true, popup: false });
      } catch (e) {
        // «No match» и подобные ошибки после тишины — просто пробуем снова.
        scheduleRestart(500);
      }
    }

    function scheduleRestart(ms) {
      clearTimeout(restartTimer);
      if (active) restartTimer = setTimeout(begin, ms);
    }

    return {
      async start(textCb, errCb) {
        onText = textCb;
        committed = '';
        current = '';
        const ok = await settle(ensurePermission(), 30000);
        if (!ok) { errCb && errCb('not-allowed'); return false; }
        active = true;
        const h1 = await settle(nativeSR.addListener('partialResults', (d) => {
          current = (d.matches && d.matches[0]) || current;
          lastResultAt = Date.now();
          emit();
        }), 3000);
        const h2 = await settle(nativeSR.addListener('listeningState', (d) => {
          // Распознаватель сам останавливается после паузы — даём ему прислать окончательный текст и перезапускаем.
          if (d.status === 'stopped') scheduleRestart(700);
        }), 3000);
        handles = [h1, h2].filter(Boolean);
        begin();
        return true;
      },
      async stop() {
        active = false;
        clearTimeout(restartTimer);
        const stoppedAt = Date.now();
        try { nativeSR.stop().catch(() => {}); } catch (e) { /* уже остановлен */ }
        // Ждём окончательный текст последней фразы (не дольше 0,8 с).
        await wait(500);
        if (lastResultAt > stoppedAt - 300) await wait(300);
        commit();
        handles.forEach((h) => { try { const r = h.remove(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ок */ } });
        handles = [];
        return committed;
      },
    };
  }

  // ---- Браузер: Web Speech API.
  function webListener() {
    let rec = null;
    let active = false;
    let committed = '';
    let sessionFinal = '';
    let sessionInterim = '';
    let onText = null;
    // На Android-Chrome непрерывный режим дублирует фразы — там слушаем короткими сессиями.
    const continuous = !/Android/i.test(navigator.userAgent);

    const emit = () => onText && onText([committed, sessionFinal, sessionInterim].join(' ').replace(/\s+/g, ' ').trim());

    function commitSession() {
      const t = (sessionFinal + ' ' + sessionInterim).trim();
      if (t) committed = (committed + ' ' + t).trim();
      sessionFinal = '';
      sessionInterim = '';
    }

    function makeRec(errCb) {
      const r = new WebSR();
      r.lang = 'ru-RU';
      r.interimResults = true;
      r.continuous = continuous;
      r.maxAlternatives = 1;
      r.onresult = (ev) => {
        let fin = '';
        let int = '';
        for (let i = 0; i < ev.results.length; i++) {
          const txt = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) fin += ' ' + txt; else int += ' ' + txt;
        }
        sessionFinal = fin.trim();
        sessionInterim = int.trim();
        emit();
      };
      r.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') {
          active = false;
          errCb && errCb(ev.error === 'audio-capture' ? 'no-mic' : 'not-allowed');
        }
      };
      r.onend = () => {
        commitSession();
        emit();
        if (active) {
          setTimeout(() => { if (active) { try { rec = makeRec(errCb); rec.start(); } catch (e) { /* ок */ } } }, 150);
        }
      };
      return r;
    }

    return {
      async start(textCb, errCb) {
        onText = textCb;
        committed = '';
        sessionFinal = '';
        sessionInterim = '';
        active = true;
        try {
          rec = makeRec(errCb);
          rec.start();
          return true;
        } catch (e) {
          active = false;
          errCb && errCb('failed');
          return false;
        }
      },
      async stop() {
        active = false;
        try { rec && rec.stop(); } catch (e) { /* ок */ }
        commitSession();
        return committed;
      },
    };
  }

  window.Speech = {
    isNative,
    // Есть ли вообще способ распознавать речь (синхронная оценка; точный ответ — checkAvailable()).
    supported: !!nativeSR || !!WebSR,
    checkAvailable,
    create() { return nativeSR ? nativeListener() : webListener(); },
  };

  // Вибрация в Android-приложении — через плагин Haptics (в браузере — navigator.vibrate в fx.js).
  const haptics = window.Native.plugin('Haptics');
  if (haptics) {
    window.NativeHaptics = {
      light() { haptics.impact({ style: 'LIGHT' }).catch(() => {}); },
      heavy() { haptics.notification({ type: 'ERROR' }).catch(() => {}); },
      success() { haptics.notification({ type: 'SUCCESS' }).catch(() => {}); },
    };
  }
})();
