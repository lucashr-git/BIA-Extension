(() => {
  if (window.__flowQAHookInstalled) return;
  window.__flowQAHookInstalled = true;

  const NONCE = window.__FLOW_QA_NONCE;
  try { delete window.__FLOW_QA_NONCE; } catch (_) {}

  let contentReady = false;
  const pending = [];

  function post(kind, entry) {
    if (!contentReady) {
      pending.push({ kind, entry });
      if (pending.length > 150) pending.shift();
      return;
    }
    try {
      window.postMessage({ source: 'flow-qa-hook', nonce: NONCE, kind, entry }, '*');
    } catch (_) {}
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'flow-qa-content') return;
    if (e.data.nonce !== NONCE) return;
    if (e.data.kind === 'ready' && !contentReady) {
      contentReady = true;
      for (const item of pending.splice(0)) {
        try {
          window.postMessage({ source: 'flow-qa-hook', nonce: NONCE, kind: item.kind, entry: item.entry }, '*');
        } catch (_) {}
      }
    }
  });

  function safeString(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value).slice(0, 2000); } catch (_) { return String(value); }
  }

  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      post('console', {
        level,
        type: `console.${level}`,
        message: args.map(safeString).join(' ').slice(0, 2000),
        time: new Date().toISOString(),
      });
      original(...args);
    };
  }

  window.addEventListener('error', (e) => {
    post('console', {
      level: 'error',
      type: 'error',
      message: String(e.message || '').slice(0, 2000),
      source: e.filename,
      line: e.lineno,
      col: e.colno,
      time: new Date().toISOString(),
    });
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    post('console', {
      level: 'error',
      type: 'unhandledRejection',
      message: safeString(e.reason).slice(0, 2000),
      time: new Date().toISOString(),
    });
  }, true);

  let inflight = 0;
  function trackStart() { inflight++; post('inflight', { count: inflight }); }
  function trackEnd()   { inflight = Math.max(0, inflight - 1); post('inflight', { count: inflight }); }

  /* ===== Detalhe nível DevTools (headers, corpo) =====
     Capturado aqui no mundo MAIN, onde fetch/XHR realmente acontecem. Cobre todo o tráfego
     de API da aplicação sem precisar anexar o depurador (que mostraria o banner "está sendo
     depurado" e brigaria com o DevTools do próprio usuário). Fica de fora o que não passa por
     fetch/XHR: navegação de documento, imagens, preflight CORS e headers que o navegador
     adiciona sozinho (Cookie, Origin, Sec-*). */

  const MAX_HEADERS = 40;
  const MAX_HEADER_CHARS = 1024;
  const MAX_BODY_CHARS = 8000;
  const BODY_MIME = /json|text|xml|javascript|x-www-form-urlencoded/i;

  function trimHeaders(pairs) {
    const out = {};
    let n = 0;
    for (const [k, v] of pairs) {
      if (n++ >= MAX_HEADERS) { out['…'] = `+${pairs.length - MAX_HEADERS} header(s) omitido(s)`; break; }
      out[String(k).toLowerCase()] = String(v).slice(0, MAX_HEADER_CHARS);
    }
    return out;
  }

  function requestHeadersFrom(input, init) {
    try {
      const h = (init && init.headers) || (input && input.headers);
      if (!h) return {};
      if (typeof h.entries === 'function') return trimHeaders([...h.entries()]);
      if (Array.isArray(h)) return trimHeaders(h);
      return trimHeaders(Object.entries(h));
    } catch (_) { return {}; }
  }

  function responseHeadersFrom(res) {
    try { return trimHeaders([...res.headers.entries()]); } catch (_) { return {}; }
  }

  function parseXhrHeaders(raw) {
    if (!raw) return {};
    return trimHeaders(
      raw.trim().split(/[\r\n]+/).map((line) => {
        const i = line.indexOf(':');
        return i === -1 ? [line, ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      })
    );
  }

  function shouldReadBody(headers, sizeHint) {
    const type = headers['content-type'] || '';
    if (!BODY_MIME.test(type)) return false;
    const len = Number(headers['content-length'] || sizeHint || 0);
    return !len || len <= 512 * 1024;
  }

  function bodyPreview(text) {
    const s = String(text ?? '');
    return { body: s.slice(0, MAX_BODY_CHARS), bodyTruncated: s.length > MAX_BODY_CHARS, bodyChars: s.length };
  }

  function requestBodyOf(init) {
    try {
      const b = init && init.body;
      if (typeof b === 'string') return bodyPreview(b).body;
      if (b instanceof URLSearchParams) return bodyPreview(b.toString()).body;
    } catch (_) { /* FormData, Blob e streams ficam de fora de propósito */ }
    return undefined;
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const requestHeaders = requestHeadersFrom(input, init);
    const requestBody = requestBodyOf(init);
    const start = Date.now();
    trackStart();
    return origFetch.apply(this, arguments).then((res) => {
      trackEnd();
      const responseHeaders = responseHeadersFrom(res);
      const entry = {
        type: 'fetch', url: url.slice(0, 300), method,
        status: res.status, ok: res.ok,
        duration: (Date.now() - start) + 'ms',
        time: new Date().toISOString(),
        requestHeaders, responseHeaders,
        ...(requestBody ? { requestBody } : {}),
      };
      // Clonar custa memória, então só em respostas pequenas e textuais.
      if (shouldReadBody(responseHeaders)) {
        res.clone().text().then((text) => post('network', { ...entry, ...bodyPreview(text) }))
          .catch(() => post('network', entry));
      } else {
        post('network', entry);
      }
      return res;
    }).catch((err) => {
      trackEnd();
      post('network', {
        type: 'fetch', url: url.slice(0, 300), method,
        status: 0, ok: false, error: String(err && err.message || err),
        duration: (Date.now() - start) + 'ms',
        time: new Date().toISOString(),
        requestHeaders,
      });
      throw err;
    });
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__flowQaMethod = String(method || 'GET').toUpperCase();
    this.__flowQaUrl = String(url || '');
    this.__flowQaReqHeaders = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (!this.__flowQaReqHeaders) this.__flowQaReqHeaders = {};
      if (Object.keys(this.__flowQaReqHeaders).length < MAX_HEADERS) {
        this.__flowQaReqHeaders[String(name).toLowerCase()] = String(value).slice(0, MAX_HEADER_CHARS);
      }
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const start = Date.now();
    const requestBody = typeof body === 'string' ? bodyPreview(body).body : undefined;
    trackStart();
    this.addEventListener('loadend', () => {
      trackEnd();
      const responseHeaders = parseXhrHeaders(this.getAllResponseHeaders && this.getAllResponseHeaders());
      const entry = {
        type: 'xhr',
        url: (this.__flowQaUrl || '').slice(0, 300),
        method: this.__flowQaMethod || 'GET',
        status: this.status,
        ok: this.status >= 200 && this.status < 400,
        duration: (Date.now() - start) + 'ms',
        time: new Date().toISOString(),
        requestHeaders: this.__flowQaReqHeaders || {},
        responseHeaders,
        ...(requestBody ? { requestBody } : {}),
      };
      // responseText só existe em responseType '' ou 'text'; nos demais lê-lo lança.
      if (shouldReadBody(responseHeaders) && (this.responseType === '' || this.responseType === 'text')) {
        try { Object.assign(entry, bodyPreview(this.responseText)); } catch (_) {}
      }
      post('network', entry);
    });
    return origSend.apply(this, arguments);
  };
})();
