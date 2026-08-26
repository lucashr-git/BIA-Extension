/* Captura de rede em nível de navegador, via CDP (domínio Network).

   Complementa o hook de fetch/XHR de page-hook.js, que já cobre o tráfego de API da
   aplicação. O que só o CDP enxerga:
   • headers que o navegador adiciona sozinho (Cookie, Origin, Sec-*, User-Agent);
   • Set-Cookie cru, sem colapsar duplicatas;
   • requisições de navegação de documento e preflight CORS;
   • timing de DNS/TLS/TTFB.

   Ligada SOB DEMANDA: manter Network.enable o tempo todo deixaria o banner "está sendo
   depurado" permanente e bloquearia o DevTools do usuário durante toda a sessão. O custo
   é não capturar o que já passou — por isso as ferramentas devolvem uma mensagem
   explicando que basta refazer a ação. */

import { cdp, cdpAttach } from './cdp.js';

const MAX_REQUESTS = 150;
const MAX_BODY_CHARS = 8000;
const MAX_HEADERS = 40;
const MAX_HEADER_CHARS = 1024;

// Tipos que só fariam volume: nada disso ajuda a diagnosticar API.
const IGNORED_TYPES = new Set(['Image', 'Font', 'Stylesheet', 'Media', 'Manifest', 'Ping', 'CSPViolationReport']);
const BODY_WORTH_TYPES = new Set(['XHR', 'Fetch', 'Document']);

const buffers = new Map(); // tabId → { order, byId, ignored, stale }

function bufferFor(tabId) {
  if (!buffers.has(tabId)) {
    buffers.set(tabId, { order: [], byId: new Map(), ignored: new Set(), stale: '' });
  }
  return buffers.get(tabId);
}

export async function armNetworkCapture(tabId) {
  await cdpAttach(tabId);
  await cdp(tabId, 'Network.enable', {
    maxTotalBufferSize: 10 * 1024 * 1024,
    maxResourceBufferSize: 5 * 1024 * 1024,
    maxPostDataSize: 65536,
  });
  const buf = bufferFor(tabId);
  buf.stale = '';
  return true;
}

export async function disarmNetworkCapture(tabId) {
  if (!buffers.has(tabId)) return;
  await cdp(tabId, 'Network.disable').catch(() => {});
}

export function clearNetlog(tabId) {
  buffers.delete(tabId);
}

// Chamado quando o Chrome tira a sessão do depurador da extensão (o caso mais comum é o
// usuário abrir o DevTools na aba). Sem isso, o buffer continuaria respondendo com dados
// congelados sem ninguém perceber.
function markNetlogStale(tabId, reason) {
  if (!buffers.has(tabId)) return;
  buffers.get(tabId).stale = reason || 'a captura foi interrompida';
}

function trimHeaders(headers) {
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(headers || {})) {
    if (n++ >= MAX_HEADERS) { out['…'] = 'headers omitidos'; break; }
    out[String(k).toLowerCase()] = String(v).slice(0, MAX_HEADER_CHARS);
  }
  return out;
}

function evict(buf) {
  while (buf.order.length > MAX_REQUESTS) {
    // Falhas são o que interessa investigar — as 2xx saem primeiro.
    const victim = buf.order.find((id) => {
      const e = buf.byId.get(id);
      return e && !(e.status >= 400) && !e.failed;
    }) ?? buf.order[0];
    buf.order = buf.order.filter((id) => id !== victim);
    buf.byId.delete(victim);
  }
}

function entryFor(buf, requestId) {
  let entry = buf.byId.get(requestId);
  if (!entry) {
    entry = { requestId, requestHeaders: {}, responseHeaders: {} };
    buf.byId.set(requestId, entry);
    buf.order.push(requestId);
    evict(buf);
  }
  return entry;
}

/* Listener próprio, em vez de estender o de cdp.js: evita que cdp.js precise importar
   netlog.js (que já importa cdp.js) e o ciclo de imports que isso criaria. O Chrome
   entrega o evento a todos os listeners registrados. */
if (chrome.debugger?.onEvent) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source?.tabId == null) return;
    // Sai cedo no evento mais frequente de todos (um por frame de vídeo).
    if (method === 'Page.screencastFrame') return;
    if (method.startsWith('Network.')) handleNetworkEvent(source.tabId, method, params);
    else if (method === 'Page.frameNavigated') handleFrameNavigated(source.tabId, params);
  });
}

if (chrome.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source?.tabId == null) return;
    markNetlogStale(
      source.tabId,
      reason === 'replaced_with_devtools'
        ? 'o DevTools foi aberto nesta aba e assumiu o depurador'
        : `a conexão do depurador caiu (${reason || 'motivo desconhecido'})`
    );
  });
}

function handleNetworkEvent(tabId, method, params) {
  if (tabId == null || !method.startsWith('Network.')) return;
  const buf = buffers.get(tabId);
  if (!buf) return;   // captura não armada nesta aba
  const id = params?.requestId;

  if (method === 'Network.requestWillBeSent') {
    if (IGNORED_TYPES.has(params.type)) { buf.ignored.add(id); return; }
    const e = entryFor(buf, id);
    e.url = String(params.request?.url || '').slice(0, 500);
    e.method = params.request?.method || 'GET';
    e.type = params.type;
    e.postData = params.request?.postData ? String(params.request.postData).slice(0, MAX_BODY_CHARS) : undefined;
    e.startedAt = new Date().toISOString();
    Object.assign(e.requestHeaders, trimHeaders(params.request?.headers));
    if (params.redirectResponse) e.redirectedFrom = params.redirectResponse.url;
    return;
  }

  if (buf.ignored.has(id)) return;

  switch (method) {
    // *ExtraInfo pode chegar ANTES do evento principal — por isso entryFor cria a entrada
    // sob demanda em vez de exigir que ela já exista.
    case 'Network.requestWillBeSentExtraInfo':
      Object.assign(entryFor(buf, id).requestHeaders, trimHeaders(params.headers));
      break;
    case 'Network.responseReceived': {
      const e = entryFor(buf, id);
      const r = params.response || {};
      e.status = r.status;
      e.statusText = r.statusText;
      e.mimeType = r.mimeType;
      e.protocol = r.protocol;
      e.remoteIP = r.remoteIPAddress;
      e.fromCache = !!r.fromDiskCache;
      e.timing = r.timing;
      e.type = params.type || e.type;
      Object.assign(e.responseHeaders, trimHeaders(r.headers));
      break;
    }
    case 'Network.responseReceivedExtraInfo': {
      const e = entryFor(buf, id);
      Object.assign(e.responseHeaders, trimHeaders(params.headers));
      if (params.headersText) {
        // headersText preserva múltiplos Set-Cookie, que o objeto headers colapsa.
        const setCookies = params.headersText.split(/\r?\n/).filter((l) => /^set-cookie:/i.test(l));
        if (setCookies.length > 1) e.setCookieRaw = setCookies.map((l) => l.slice(l.indexOf(':') + 1).trim());
      }
      break;
    }
    case 'Network.loadingFinished': {
      const e = entryFor(buf, id);
      e.finished = true;
      e.encodedDataLength = params.encodedDataLength;
      break;
    }
    case 'Network.loadingFailed': {
      const e = entryFor(buf, id);
      e.failed = true;
      e.errorText = params.errorText;
      e.canceled = params.canceled;
      e.blockedReason = params.blockedReason;
      break;
    }
    default:
      break;
  }
}

// Navegação de documento invalida os corpos no cache do CDP; guardar as últimas entradas
// da página anterior permite investigar justamente a requisição que causou a navegação.
function handleFrameNavigated(tabId, params) {
  const buf = buffers.get(tabId);
  if (!buf || params?.frame?.parentId) return;
  const keep = buf.order.slice(-20);
  buf.order = keep;
  for (const key of [...buf.byId.keys()]) if (!keep.includes(key)) buf.byId.delete(key);
  buf.ignored.clear();
}

function entries(tabId) {
  const buf = buffers.get(tabId);
  if (!buf) return [];
  return buf.order.map((id) => buf.byId.get(id)).filter(Boolean);
}

export function findCdpRequests(tabId, urlIncludes = '') {
  const needle = String(urlIncludes).toLowerCase();
  return entries(tabId).filter((e) => e.url && (!needle || e.url.toLowerCase().includes(needle)));
}

export function netlogStatus(tabId) {
  const buf = buffers.get(tabId);
  if (!buf) return { armed: false, stale: '', count: 0 };
  return { armed: !buf.stale, stale: buf.stale, count: buf.order.length };
}

export async function fetchCdpBody(tabId, requestId, maxChars = 4000) {
  try {
    const res = await cdp(tabId, 'Network.getResponseBody', { requestId });
    if (!res) return null;
    if (res.base64Encoded) return '(corpo binário — não exibido)';
    return String(res.body || '').slice(0, Math.min(maxChars, MAX_BODY_CHARS));
  } catch (e) {
    return `(corpo indisponível: ${e.message} — a página navegou ou o buffer do navegador rotacionou; refaça a ação para capturá-lo de novo)`;
  }
}

export function shouldFetchBody(entry) {
  return !!entry && entry.finished && BODY_WORTH_TYPES.has(entry.type)
    && (entry.status >= 400 || /json|text|xml/i.test(entry.mimeType || ''));
}

export function formatTiming(timing) {
  if (!timing) return '';
  const ms = (a, b) => (a >= 0 && b >= 0 && b >= a ? `${Math.round(b - a)}ms` : '—');
  return [
    `DNS ${ms(timing.dnsStart, timing.dnsEnd)}`,
    `Connect ${ms(timing.connectStart, timing.connectEnd)}`,
    `TLS ${ms(timing.sslStart, timing.sslEnd)}`,
    `TTFB ${ms(timing.sendEnd, timing.receiveHeadersEnd)}`,
  ].join(' · ');
}
