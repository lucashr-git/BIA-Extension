(() => {
if (window.__flowQAContentInstalled) return;
window.__flowQAContentInstalled = true;

const NONCE = window.__FLOW_QA_NONCE;
try { delete window.__FLOW_QA_NONCE; } catch (_) {}

const consoleBuffer = [];
const networkBuffer = [];
let inflightRequests = 0;

// Entradas de rede agora carregam headers e corpo. Manter o corpo de tudo estouraria a
// memória numa SPA que faz polling, então só as mais recentes o conservam — que são as
// que interessam para investigar o que acabou de acontecer.
const NETWORK_BUFFER_MAX = 120;
const NETWORK_BODIES_KEPT = 15;

function trimOldBodies() {
  for (let i = 0; i < networkBuffer.length - NETWORK_BODIES_KEPT; i++) {
    const entry = networkBuffer[i];
    if (entry && entry.body !== undefined) {
      delete entry.body;
      entry.bodyDropped = true;
    }
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'flow-qa-hook') return;
  if (e.data.nonce !== NONCE) return;
  if (e.data.kind === 'console') {
    consoleBuffer.push(e.data.entry);
    if (consoleBuffer.length > 100) consoleBuffer.shift();
  } else if (e.data.kind === 'network') {
    networkBuffer.push(e.data.entry);
    if (networkBuffer.length > NETWORK_BUFFER_MAX) networkBuffer.shift();
    trimOldBodies();
  } else if (e.data.kind === 'inflight') {
    inflightRequests = e.data.entry?.count || 0;
  }
});

try {
  window.postMessage({ source: 'flow-qa-content', kind: 'ready', nonce: NONCE }, '*');
} catch (_) {}

const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'textarea', 'select',
  "[role='button']", "[role='link']", "[role='menuitem']",
  "[role='option']", "[role='tab']", "[role='checkbox']", "[role='combobox']",
  "[contenteditable='true']",
  '[data-testid]', '[data-test]', '[data-cy]',
].join(',');

const HIDDEN_BUT_CLICKABLE = 'input,select,textarea,button';

const lastScanById = new Map();
const lastScanByIndex = new Map();
let previousIds = new Set();
let scanCounter = 0;
// Assinatura da página no momento do scan que gerou os índices atuais — usada para
// decidir se um índice ficou "stale" quando o re-match falha (ver resolveScannedTarget).
let lastScanSignature = null;
// Marcador único no início da mensagem de erro para o agent.js reconhecer "elemento
// stale" sem precisar de um canal estruturado extra (o resultado atravessa runActionsWithStatus
// em actions.js, que só propaga a string de erro).
const STALE_MARKER = '[[STALE]]';
// Preenchido pelo findTarget() quando a resolução por índice falha e é considerada stale;
// consumido por targetNotFound()/notFoundResult() logo em seguida, na mesma execução síncrona.
let lastStaleInfo = null;

function isVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (parseFloat(style.opacity) > 0) return true;
  // Temas como Ace, Bootstrap custom-control e Material escondem o input real
  // com opacity:0 atrás de uma label estilizada. Ele segue clicável e é o único
  // jeito de mudar o estado do controle.
  return el.matches(HIDDEN_BUT_CLICKABLE);
}

function normalizeText(value) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function normalize(value) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function truncate(value, max) {
  return value && value.length > max ? value.slice(0, max) : value;
}

function cssStringEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function collectShadowRoots(root = document) {
  const roots = [root];
  for (let i = 0; i < roots.length; i++) {
    const walker = document.createTreeWalker(roots[i], NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) roots.push(node.shadowRoot);
    }
  }
  return roots;
}

function queryAllIn(roots, selector) {
  const out = [];
  for (const r of roots) {
    try { out.push(...r.querySelectorAll(selector)); } catch (_) {}
  }
  return out;
}

function queryFirstIn(roots, selector) {
  for (const r of roots) {
    try {
      const found = r.querySelector(selector);
      if (found) return found;
    } catch (_) {}
  }
  return null;
}

function deepQuerySelectorAll(selector, root = document) {
  return queryAllIn(collectShadowRoots(root), selector);
}

function findStableAttribute(el) {
  for (const name of ['data-testid', 'data-test', 'data-cy', 'data-test-id']) {
    const value = el.getAttribute(name);
    if (value) return { name, value };
  }
  return null;
}

function inferRole(el) {
  if (el instanceof HTMLAnchorElement) return 'link';
  if (el instanceof HTMLButtonElement) return 'button';
  if (el instanceof HTMLInputElement) return el.type === 'submit' ? 'button' : 'input';
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLTextAreaElement) return 'textbox';
  return el.tagName.toLowerCase();
}

function findLabel(el) {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label') || undefined;
  if (el.id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return normalizeText(label.innerText);
    } catch (_) {}
  }
  const parentLabel = el.closest('label');
  return parentLabel ? normalizeText(parentLabel.textContent || '') : undefined;
}

function buildXPath(el) {
  const segments = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.tagName.toLowerCase();
    let position = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === tagName) position += 1;
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${tagName}[${position}]`);
    current = current.parentElement;
  }
  return `/${segments.join('/')}`;
}

function extractUsefulAttributes(el) {
  const names = ['data-testid', 'data-test', 'data-cy', 'data-test-id', 'aria-label',
    'aria-expanded', 'aria-checked', 'aria-pressed', 'name', 'type', 'role', 'title',
    'placeholder', 'href', 'alt'];
  const attrs = {};
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value && value.trim()) attrs[name] = truncate(normalizeText(value) || value, 160);
  }
  return Object.keys(attrs).length ? attrs : undefined;
}

function extractContextText(el) {
  const direct = normalizeText(el.innerText || el.textContent || '');
  const label = findLabel(el);
  const container = el.closest("label, form, fieldset, [role='group'], [data-testid], [data-test], [data-cy]");
  const containerText = container instanceof HTMLElement
    ? normalizeText(container.innerText || container.textContent || '')
    : undefined;
  const context = [label, direct, containerText].filter(Boolean).join(' ');
  return context ? truncate(context, 300) : undefined;
}

function toVisibleElement(el, index, rect, vh, vw) {
  const id = el.dataset.flowQaId || `flow-qa-${++scanCounter}-${index}`;
  el.dataset.flowQaId = id;

  let selectorHint = `[data-flow-qa-id="${id}"]`;
  const stable = findStableAttribute(el);
  if (stable) {
    selectorHint = `[${stable.name}="${cssStringEscape(stable.value)}"]`;
  } else if (el.id && !el.id.startsWith('flow-qa-')) {
    selectorHint = `#${CSS.escape(el.id)}`;
  } else if (el.getAttribute('name')) {
    selectorHint = `${el.tagName.toLowerCase()}[name="${cssStringEscape(el.getAttribute('name'))}"]`;
  }

  const isFormField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

  return {
    id,
    index: index + 1,
    role: el.getAttribute('role') || inferRole(el),
    tagName: el.tagName.toLowerCase(),
    text: truncate(normalizeText(el.innerText || el.textContent || '') || '', 120) || undefined,
    label: findLabel(el),
    placeholder: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? (el.placeholder || undefined) : undefined,
    inputType: el instanceof HTMLInputElement ? el.type : undefined,
    href: el instanceof HTMLAnchorElement ? el.href : undefined,
    value: isFormField ? truncate(String(el.value), 120) : undefined,
    disabled: (el.disabled === true) || el.getAttribute('aria-disabled') === 'true' || undefined,
    selectorHint,
    xpath: buildXPath(el),
    attributes: extractUsefulAttributes(el),
    contextText: extractContextText(el),
    rect: {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
    },
    inViewport: rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw,
  };
}

function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

function collectVisibleText() {
  return (normalizeText(document.body ? document.body.innerText : '') || '').slice(0, 8000);
}

function signatureText(maxLen) {
  if (!document.body) return '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement && node.parentElement.tagName;
      return tag && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(tag)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  let node;
  while (text.length < maxLen && (node = walker.nextNode())) {
    text += node.textContent;
  }
  return text.slice(0, maxLen);
}

function getPageSignature(elementCount) {
  return {
    url: location.href,
    title: document.title,
    elementCount: typeof elementCount === 'number'
      ? elementCount
      : deepQuerySelectorAll(INTERACTIVE_SELECTOR).length,
    textHash: hashText(signatureText(20000)),
  };
}

function distanceToViewport(rect, vh) {
  if (rect.bottom <= 0) return -rect.bottom;
  if (rect.top >= vh)   return rect.top - vh;
  return 0;
}

function scanVisibleDom() {
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;

  const candidates = [];
  for (const el of deepQuerySelectorAll(INTERACTIVE_SELECTOR)) {
    if (!(el instanceof HTMLElement)) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;

    if (parseFloat(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    candidates.push({ el, rect });
  }

  let interactiveAbove = 0, interactiveBelow = 0;
  for (const c of candidates) {
    if (c.rect.bottom <= 0) interactiveAbove++;
    else if (c.rect.top >= vh) interactiveBelow++;
  }

  candidates.sort((a, b) => distanceToViewport(a.rect, vh) - distanceToViewport(b.rect, vh));
  const chosen = candidates.slice(0, 180);

  lastScanById.clear();
  lastScanByIndex.clear();
  const currentIds = new Set();

  const elements = chosen.map((c, i) => toVisibleElement(c.el, i, c.rect, vh, vw));
  for (const rec of elements) {
    lastScanById.set(rec.id, rec);
    lastScanByIndex.set(rec.index, rec);
    rec.isNew = !previousIds.has(rec.id);
    currentIds.add(rec.id);
  }
  previousIds = currentIds;

  const signature = getPageSignature(candidates.length);
  lastScanSignature = signature;

  return {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
      height: Math.round(document.documentElement.scrollHeight),
      viewportHeight: Math.round(vh),
    },
    interactiveAbove,
    interactiveBelow,
    visibleText: collectVisibleText(),
    elements,
    signature,
    capturedAt: new Date().toISOString(),
  };
}

function resolveXPath(xpath) {
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue instanceof HTMLElement ? result.singleNodeValue : null;
  } catch (_) {
    return null;
  }
}

// Comparação tolerante: normalize() já faz trim + collapse de espaços + lowercase.
// Aceita também comparação por prefixo (texto truncado no scan vs. texto completo no DOM).
function recordMatchesElement(rec, el) {
  if (!el) return false;
  if (rec.tagName && el.tagName && el.tagName.toLowerCase() !== rec.tagName) return false;
  if (rec.role) {
    const elRole = normalize(el.getAttribute('role') || inferRole(el));
    const recRole = normalize(rec.role);
    if (recRole && elRole && recRole !== elRole) return false;
  }
  const recText = normalize(rec.text || rec.label || '');
  if (recText && recText.length > 2) {
    const elText = normalize(
      el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || ''
    );
    if (elText && !elText.includes(recText) && !recText.includes(elText)) return false;
  }
  return true;
}

// Passo (c) do re-match: quando selectorHint e xpath falham, procura no DOM atual por
// texto+role — igual à busca livre usada quando o alvo não vem por índice (findTarget).
function findByTextRoleFallback(rec) {
  const roots = collectShadowRoots();
  const wantedText = normalize(rec.text || rec.label || rec.placeholder || '');
  if (!wantedText || wantedText.length <= 2) return null;
  const wantedRole = normalize(rec.role || '');
  const candidates = queryAllIn(roots, INTERACTIVE_SELECTOR).filter(isVisible);
  const roleMatches = (c) => !wantedRole || normalize(c.getAttribute('role') || inferRole(c)) === wantedRole;
  const textOf = (c) => normalize(
    c.innerText || c.textContent || c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.getAttribute('value') || ''
  );
  const byExact = candidates.find((c) => roleMatches(c) && textOf(c) === wantedText);
  if (byExact) return byExact;
  return candidates.find((c) => roleMatches(c) && textOf(c).includes(wantedText)) || null;
}

// Compara a assinatura do scan que originou o índice com a assinatura atual da página,
// recalculada na hora (rápida — sem percorrer 20000 chars de novo além do necessário).
function pageSignatureDiverged(oldSignature) {
  if (!oldSignature) return { diverged: false, reason: '' };
  const current = getPageSignature();
  if (current.url !== oldSignature.url) {
    return { diverged: true, reason: 'a URL da página mudou' };
  }
  if (current.textHash !== oldSignature.textHash) {
    return { diverged: true, reason: 'o conteúdo da página mudou desde o último scan' };
  }
  if (Math.abs((current.elementCount || 0) - (oldSignature.elementCount || 0)) > 2) {
    return { diverged: true, reason: 'o número de elementos interativos da página mudou' };
  }
  return { diverged: false, reason: '' };
}

// Re-match do registro escaneado antes de agir sobre ele (spec: elimina cliques em
// elemento errado quando o DOM mudou entre o scan e a ação). Ordem de tentativa:
//   0) data-flow-qa-id (o próprio nó ainda está no DOM, mais confiável que tudo)
//   a) selectorHint (data-testid/id/name)
//   b) xpath armazenado, validando texto/role tolerantemente
//   c) busca livre por texto+role no DOM atual
// Se nada casar, devolve { stale: true, reason } em vez de agir às cegas.
function resolveScannedTarget(rec) {
  const roots = collectShadowRoots();
  let el = null;

  try {
    const byFlowId = queryFirstIn(roots, `[data-flow-qa-id="${CSS.escape(rec.id)}"]`);
    if (byFlowId && isVisible(byFlowId)) el = byFlowId;
  } catch (_) {}

  if (!el && rec.selectorHint) {
    try {
      const bySelector = queryFirstIn(roots, rec.selectorHint);
      if (bySelector && isVisible(bySelector) && recordMatchesElement(rec, bySelector)) el = bySelector;
    } catch (_) {}
  }

  if (!el && rec.xpath) {
    const byXPath = resolveXPath(rec.xpath);
    if (byXPath && isVisible(byXPath) && recordMatchesElement(rec, byXPath)) el = byXPath;
  }

  if (!el) {
    const byTextRole = findByTextRoleFallback(rec);
    if (byTextRole && isVisible(byTextRole)) el = byTextRole;
  }

  if (el) return { el, stale: false, reason: '' };

  const { diverged, reason } = pageSignatureDiverged(lastScanSignature);
  return {
    el: null,
    stale: true,
    reason: diverged ? reason : 'o elemento não foi encontrado no DOM atual (pode ter sido removido ou substituído)',
  };
}

function findTarget(target) {
  lastStaleInfo = null;
  if (!target) return null;

  if (typeof target.index === 'number') {
    const historical = lastScanByIndex.get(target.index);
    if (!historical) {
      lastStaleInfo = { stale: true, reason: 'o índice informado não existe na lista escaneada mais recente' };
      return null;
    }
    const resolved = resolveScannedTarget(historical);
    if (resolved.stale) lastStaleInfo = resolved;
    return resolved.el;
  }

  const roots = collectShadowRoots();
  const wantedText = (target.text && target.text !== target.selectorHint ? target.text : target.label) || '';

  if (target.selectorHint) {
    try {
      const bySelector = queryFirstIn(roots, target.selectorHint);
      if (bySelector && isVisible(bySelector) && recordMatchesElement({ text: wantedText }, bySelector)) return bySelector;
    } catch (_) {}
  }

  if (target.id) {
    try {
      const byFlowId = queryFirstIn(roots, `[data-flow-qa-id="${CSS.escape(target.id)}"]`);
      if (byFlowId && isVisible(byFlowId)) return byFlowId;
    } catch (_) {}
  }

  if (target.xpath) {
    const byXPath = resolveXPath(target.xpath);
    if (byXPath && isVisible(byXPath) && recordMatchesElement({ text: wantedText }, byXPath)) return byXPath;
  }

  const candidates = queryAllIn(roots, INTERACTIVE_SELECTOR).filter(isVisible);

  let effectiveText = target.text || target.label || '';
  let effectiveRole = target.role || '';

  if (!effectiveText && target.id) {
    const historical = lastScanById.get(target.id);
    if (historical) {
      effectiveText = historical.text || historical.label || historical.placeholder || '';
      effectiveRole = effectiveRole || historical.role || '';
    }
  }

  const targetText = normalize(effectiveText);
  const targetRole = normalize(effectiveRole);

  const roleMatches = (candidate) =>
    !targetRole || normalize(candidate.getAttribute('role') || inferRole(candidate)) === targetRole;

  if (targetText) {
    const byStable = candidates.find((candidate) => {
      if (!roleMatches(candidate)) return false;
      const attrs = ['data-testid', 'data-test', 'data-cy', 'aria-label', 'placeholder', 'name', 'value']
        .map((name) => candidate.getAttribute(name))
        .filter(Boolean)
        .map(normalize);
      return attrs.some((a) => a.includes(targetText));
    });
    if (byStable) return byStable;
  }

  if (targetText) {
    const textOf = (candidate) => normalize(
      candidate.innerText || candidate.textContent ||
      candidate.getAttribute('aria-label') || candidate.getAttribute('placeholder') ||
      candidate.getAttribute('value') || ''
    );
    const byExact = candidates.find((candidate) => roleMatches(candidate) && textOf(candidate) === targetText);
    if (byExact) return byExact;
    const byText = candidates.find((candidate) => roleMatches(candidate) && textOf(candidate).includes(targetText));
    if (byText) return byText;
  }

  if (targetText && targetText.length > 2) {
    const all = queryAllIn(roots, '*').filter(isVisible);
    const byAnyText = all.find((el) =>
      el.children.length === 0 && normalize(el.textContent || '').includes(targetText)
    );
    if (byAnyText) return byAnyText;
  }

  return null;
}

function extractSelectorHintText(selector) {
  const m = String(selector).match(/=["']([^"']+)["']/);
  return m ? m[1].replace(/\s+(along with|with)\s+[\d,.]+.*$/i, '').trim() : '';
}

function toTarget(act) {
  if (act.target && typeof act.target === 'object') return act.target;
  if (act.selector) return { selectorHint: act.selector, text: extractSelectorHintText(act.selector) || act.selector };
  return null;
}

function resolveForRead(act) {
  if (act.selector) {
    try {
      const el = document.querySelector(act.selector);
      if (el) return el;
    } catch (_) {}
  }
  return findTarget(toTarget(act));
}

function summarizeTarget(act) {
  const t = toTarget(act) || {};
  return `Target: ${JSON.stringify({ index: t.index, selectorHint: t.selectorHint, text: t.text, id: t.id })}`;
}

// Ponto único usado pelos handlers de ação para reportar "elemento não encontrado".
// Quando o alvo veio por índice e o re-match (resolveScannedTarget, via findTarget)
// concluiu que a página mudou desde o scan, prefixa a mensagem com STALE_MARKER: é o
// sinal que o agent.js reconhece para fazer 1 re-scan automático em vez de contar como
// falha comum — em vez de agir às cegas ou punir o modelo por um índice que só ficou
// desatualizado. Se não houver stale info (elemento simplesmente não existe, alvo por
// texto/seletor, etc.), o caminho antigo de "elemento não encontrado" permanece intacto.
function targetNotFound(act, what) {
  const t = toTarget(act) || {};
  if (lastStaleInfo && lastStaleInfo.stale && typeof t.index === 'number') {
    const reason = lastStaleInfo.reason || 'a página mudou desde o último scan';
    return {
      ok: false,
      stale: true,
      message: `${STALE_MARKER} ${what} não encontrado — ${reason}.`,
    };
  }
  let hint;
  if (typeof t.index === 'number') {
    const rec = lastScanByIndex.get(t.index);
    const recText = rec ? String(rec.text || rec.label || '').replace(/"/g, '').slice(0, 50) : '';
    const desc = rec ? ` Ele apontava para <${rec.tagName}> "${recText}".` : '';
    const recover = recText
      ? ` Releia ELEMENTOS INTERATIVOS e use o índice atual, ou localize direto: {"type":"find","text":"${recText}"}.`
      : ' Releia ELEMENTOS INTERATIVOS e use o índice atual, ou use {"type":"find","text":"..."}.';
    hint = ` O índice [${t.index}] não corresponde mais a nenhum elemento — a página mudou e a lista foi ATUALIZADA.${desc}${recover}`;
  } else {
    hint = ' Use {"type":"find","text":"..."} para localizar pelo texto, ou releia a lista de elementos.';
  }
  return { ok: false, message: `${what} não encontrado. ${summarizeTarget(act)}.${hint}` };
}

function describeElement(el) {
  const text = normalizeText(el.innerText || el.textContent || '') || '';
  return `<${el.tagName.toLowerCase()}> "${truncate(text, 60)}"`;
}

// ---- Observações ricas pós-ação -------------------------------------------------
// Depois de uma ação (click/fill/press Enter/scroll), o modelo costumava gastar steps
// extras extraindo o body só pra "conferir" o que mudou. Estes helpers capturam um
// snapshot barato (URL/título/toast visível/contagem de itens de lista) antes e depois
// da ação e resumem o delta numa string curta — reaproveitando os mesmos seletores já
// usados pelo scan (INTERACTIVE_SELECTOR, isVisible, deepQuerySelectorAll) em vez de
// varrer o DOM de novo por conta própria.
const ALERT_SELECTOR = "[role='alert'], [role='status'], .error, .toast, [aria-live='assertive'], [aria-live='polite']";

function detectProminentAlert() {
  for (const el of deepQuerySelectorAll(ALERT_SELECTOR)) {
    if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
    const text = normalizeText(el.innerText || el.textContent || '');
    if (text) return truncate(text, 100);
  }
  return null;
}

// Conta itens de lista/tabela visíveis "perto" do elemento-alvo (mesmo form/listbox/main),
// usado para detectar mudança de tamanho de lista/resultados de busca após fill/click.
function countListItemsNear(el) {
  if (!el) return null;
  const scope = (el.closest && el.closest('form, [role="search"], [role="listbox"], [role="grid"], [role="list"], main')) || document.body;
  let count = 0;
  for (const it of scope.querySelectorAll('li, tr, [role="option"], [role="row"], [role="listitem"]')) {
    if (isVisible(it)) count++;
  }
  return count;
}

function countVisibleInViewport() {
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  let count = 0;
  for (const el of deepQuerySelectorAll(INTERACTIVE_SELECTOR)) {
    if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < vh) count++;
  }
  return count;
}

function snapshotForObservation(target) {
  return {
    url: location.href,
    title: document.title,
    alert: detectProminentAlert(),
    listCount: target ? countListItemsNear(target) : null,
  };
}

// Aguarda a estabilização já usada em outros lugares (rede quieta + um respiro curto) e
// resume o que mudou em relação ao snapshot `before`. Retorna sempre uma frase curta,
// nunca undefined — inclusive "sem mudança visível detectada" quando nada foi percebido.
async function waitAndObserve(before, target, maxMs = 900) {
  await waitForNetworkQuiet(maxMs);
  await wait(150);
  const after = snapshotForObservation(target);
  const parts = [];
  if (after.url !== before.url) {
    parts.push(`url mudou para ${truncate(after.url, 120)}`);
  } else if (after.title !== before.title) {
    parts.push(`título mudou para "${truncate(after.title, 60)}"`);
  }
  if (after.alert && after.alert !== before.alert) parts.push(`mensagem visível: "${after.alert}"`);
  if (target && after.listCount !== before.listCount && (before.listCount || after.listCount)) {
    parts.push(`resultados visíveis: ${after.listCount}`);
  }
  return parts.length ? parts.join('; ') : 'sem mudança visível detectada';
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForNetworkQuiet(maxMs = 2000) {
  const start = Date.now();
  while (inflightRequests > 0 && Date.now() - start < maxMs) {
    await wait(100);
  }
}

function isFullyInViewport(rect) {
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
  return rect.top >= 0 && rect.left >= 0 && rect.bottom <= vh && rect.right <= vw;
}

async function scrollIntoViewIfNeeded(el) {
  if (isFullyInViewport(el.getBoundingClientRect())) return false;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  await waitForScrollSettle(null, 600);
  return true;
}

function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
  if (nativeSetter && nativeSetter.set) nativeSetter.set.call(el, value);
  else el.value = value;
}

function fireInputEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function realClick(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', base));
  el.dispatchEvent(new MouseEvent('mousedown', base));
  el.dispatchEvent(new PointerEvent('pointerup', base));
  el.dispatchEvent(new MouseEvent('mouseup', base));
  el.click();
}

async function actionClick(act) {
  const el = findTarget(toTarget(act));
  if (!el) return targetNotFound(act, 'Elemento para click');
  const before = snapshotForObservation(el);
  const scrolled = await scrollIntoViewIfNeeded(el);
  if (scrolled) await wait(150);
  realClick(el);
  const observation = await waitAndObserve(before, el);
  return { ok: true, message: `Click executado em ${describeElement(el)} — ${observation}`, observation };
}

async function actionType(act) {
  const el = findTarget(toTarget(act));
  if (!el) return targetNotFound(act, 'Campo');
  const value = act.text !== undefined ? String(act.text) : String(act.value ?? '');
  await scrollIntoViewIfNeeded(el);
  el.focus();
  const listBefore = countListItemsNear(el);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, value);
  } else if (el instanceof HTMLSelectElement) {
    el.value = value;
  } else {
    el.innerText = value;
  }
  fireInputEvents(el);
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true }));
  // Pequeno respiro para listas/autocompletes com debounce reagirem antes de medir.
  await wait(250);
  const listAfter = countListItemsNear(el);
  let observation = `campo agora contém "${truncate(value, 80)}"`;
  if (listAfter !== listBefore && (listBefore || listAfter)) {
    observation += `; lista visível: ${listAfter} itens`;
  }
  return { ok: true, message: `Texto preenchido em ${describeElement(el)} — ${observation}`, observation };
}

async function actionClear(act) {
  const el = findTarget(toTarget(act));
  if (!el) return targetNotFound(act, 'Campo para limpar');
  await scrollIntoViewIfNeeded(el);
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setNativeValue(el, '');
  else if (el.getAttribute('contenteditable') === 'true') el.innerText = '';
  fireInputEvents(el);
  return { ok: true, message: 'Campo limpo' };
}

async function actionPressEnter(act) {
  const explicitTarget = toTarget(act);
  let el = explicitTarget ? findTarget(explicitTarget) : null;

  if (explicitTarget && !el) return targetNotFound(act, 'Elemento para pressionar Enter');
  el = el || (document.activeElement instanceof HTMLElement ? document.activeElement : document.body);
  const before = snapshotForObservation(el);
  el.focus();
  const init = { bubbles: true, cancelable: true, composed: true, key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13 };
  const defaultAllowed = el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keypress', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));

  const form = el.closest && el.closest('form');
  if (form && el instanceof HTMLInputElement && defaultAllowed) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  const observation = await waitAndObserve(before, el);
  return { ok: true, message: `Enter pressionado — ${observation}`, observation };
}

function findSelectOption(el, wanted) {
  const raw = String(wanted ?? '');
  const norm = normalize(raw);
  return Array.from(el.options).find((o) => o.value === raw || normalize(o.text) === norm)
    || Array.from(el.options).find((o) => normalize(o.text).includes(norm) || normalize(o.value).includes(norm));
}

async function actionSelect(act) {
  const el = findTarget(toTarget(act));
  if (!(el instanceof HTMLSelectElement)) return targetNotFound(act, '<select>');
  const wanted = act.value ?? act.optionText;
  const option = findSelectOption(el, wanted);
  if (!option) return { ok: false, message: `Opção "${wanted}" não encontrada no select` };
  await scrollIntoViewIfNeeded(el);
  el.value = option.value;
  fireInputEvents(el);
  return { ok: true, message: `Opção selecionada: ${option.text}`, data: { text: option.text, value: option.value } };
}

async function actionGetDropdownOptions(act) {
  const el = findTarget(toTarget(act));
  if (!(el instanceof HTMLSelectElement)) return targetNotFound(act, 'Dropdown');
  const options = Array.from(el.options).map((option, index) => ({
    index, text: option.text, value: option.value, selected: option.selected,
  }));
  return {
    ok: true,
    message: `Dropdown contém ${options.length} opções: ${options.map((o) => o.text).join(', ')}`,
    data: { options },
  };
}

async function actionSelectDropdownOption(act) {
  const el = findTarget(toTarget(act));
  if (!(el instanceof HTMLSelectElement)) return targetNotFound(act, 'Dropdown');
  const wanted = act.optionText ?? act.value;
  const option = findSelectOption(el, wanted);
  if (!option) return { ok: false, message: `Opção de dropdown não encontrada: ${wanted}` };
  await scrollIntoViewIfNeeded(el);
  el.value = option.value;
  fireInputEvents(el);
  return { ok: true, message: `Opção selecionada: ${option.text}`, data: { text: option.text, value: option.value } };
}

async function actionCheckCheckbox(act) {
  let el = findTarget(toTarget(act));
  if (el && !(el instanceof HTMLInputElement)) {
    el = el.querySelector('input[type=checkbox],input[type=radio]') || el;
  }
  if (!el) return targetNotFound(act, 'Checkbox');

  const wanted = act.checked !== undefined && act.checked !== null ? Boolean(act.checked) : null;

  if (el instanceof HTMLInputElement) {
    const shouldBeChecked = wanted === null ? !el.checked : wanted;
    if (el.checked !== shouldBeChecked) {
      await scrollIntoViewIfNeeded(el);
      realClick(el);
      if (el.checked !== shouldBeChecked) {
        el.checked = shouldBeChecked;
        fireInputEvents(el);
      }
    }
    return { ok: true, message: `checked=${el.checked}`, data: { checked: el.checked } };
  }

  const ariaChecked = () => {
    const v = el.getAttribute('aria-checked');
    return v === null ? null : v === 'true';
  };
  const current = ariaChecked();
  const shouldBeChecked = wanted === null ? (current === null ? true : !current) : wanted;
  if (current === null || current !== shouldBeChecked) {
    await scrollIntoViewIfNeeded(el);
    realClick(el);
  }
  const after = ariaChecked();
  if (after === null) {
    return {
      ok: true,
      message: `Clique executado em ${describeElement(el)}, mas o elemento não expõe checked/aria-checked — confirme o estado com get_attribute ou pela lista de elementos`,
    };
  }
  return { ok: true, message: `checked=${after}`, data: { checked: after } };
}

function findScrollableContainer(el) {
  let current = el;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const canScroll = current.scrollHeight > current.clientHeight;
    const overflowOk = ['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflow);
    if (canScroll && overflowOk) return current;
    current = current.parentElement;
  }
  return null;
}

function scrollToPercent(container, percent) {
  if (container) {
    const top = (container.scrollHeight - container.clientHeight) * (percent / 100);
    container.scrollTo({ top, behavior: 'auto' });
    return;
  }
  const viewportHeight = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const top = (document.documentElement.scrollHeight - viewportHeight) * (percent / 100);
  window.scrollTo({ top, behavior: 'auto' });
}

function currentScrollY(container) {
  return container ? Math.round(container.scrollTop) : Math.round(window.scrollY);
}

async function waitForScrollSettle(container, maxMs = 1200) {
  let last = currentScrollY(container);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await wait(90);
    const now = currentScrollY(container);
    if (now === last) return now;
    last = now;
  }
  return last;
}

async function actionScroll(act) {
  const targetEl = toTarget(act) ? findTarget(toTarget(act)) : null;
  const container = targetEl ? findScrollableContainer(targetEl) : null;
  const before = currentScrollY(container);
  const visBefore = countVisibleInViewport();

  if (typeof act.percent === 'number') {
    scrollToPercent(container, Math.min(100, Math.max(0, act.percent)));
  } else if (act.position === 'top') {
    scrollToPercent(container, 0);
  } else if (act.position === 'bottom') {
    scrollToPercent(container, 100);
  } else {
    const amount = act.amount || Math.round(window.innerHeight * 0.75);
    const delta = (act.direction === 'up' ? -1 : 1) * amount;
    if (container) container.scrollBy({ top: delta, behavior: 'auto' });
    else window.scrollBy({ top: delta, behavior: 'auto' });
  }

  const after = await waitForScrollSettle(container);
  const moved = Math.abs(after - before);
  const scrollHeight = container ? container.scrollHeight : document.documentElement.scrollHeight;
  const viewH = container ? container.clientHeight : ((window.visualViewport && window.visualViewport.height) || window.innerHeight);
  const atBottom = (after + viewH) >= (scrollHeight - 2);
  const atTop = after <= 2;

  let observation;
  if (moved < 2) {
    observation = 'sem mudança visível detectada';
  } else {
    const visAfter = countVisibleInViewport();
    const novos = Math.max(0, visAfter - visBefore);
    observation = `rolou para ${after}px${atBottom ? ' (fim da página)' : atTop ? ' (topo)' : ''}; novos elementos visíveis: ${novos}`;
  }

  const message = moved < 2
    ? `Scroll não avançou: a página já está no ${act.direction === 'up' || act.position === 'top' ? 'topo' : 'fim'}. NÃO role de novo — use find/scroll_to_text/get_links para localizar o alvo.`
    : `Scroll: ${before}px → ${after}px${atBottom ? ' (fim da página)' : atTop ? ' (topo)' : ''} — ${observation}`;
  return { ok: true, message, observation };
}

async function actionScrollTo(act) {
  const el = findTarget(toTarget(act));
  if (!el) return targetNotFound(act, 'Elemento para scroll');
  el.scrollIntoView({ behavior: 'auto', block: 'center' });
  await waitForScrollSettle(null);
  return { ok: true, message: `Rolou até ${describeElement(el)}` };
}

function findTextOccurrence(normalizedText, nth) {
  const wantedOccurrence = Math.max(1, nth);
  let occurrence = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_REJECT;
      if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
      if (['script', 'style', 'noscript', 'svg'].includes(node.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
      if (node.children.length > 0 && Array.from(node.children).some((child) =>
        child instanceof HTMLElement && normalize(child.innerText || child.textContent || '').includes(normalizedText)
      )) {
        return NodeFilter.FILTER_SKIP;
      }
      return normalize(node.innerText || node.textContent || '').includes(normalizedText)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  let current = walker.nextNode();
  while (current) {
    if (current instanceof HTMLElement) {
      occurrence += 1;
      if (occurrence === wantedOccurrence) return current;
    }
    current = walker.nextNode();
  }
  return null;
}

async function actionScrollToText(act) {
  const text = normalize(String(act.text || ''));
  if (!text) return { ok: false, message: 'scroll_to_text inválido: text vazio' };
  const match = findTextOccurrence(text, act.nth || 1);
  if (!match) return { ok: false, message: `Texto não encontrado para scroll: ${act.text}` };
  match.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  await waitForScrollSettle(null);
  return { ok: true, message: `Rolou até o texto: ${act.text}` };
}

async function actionFind(act) {
  const query = normalize(String(act.text || act.query || ''));
  if (!query) return { ok: false, message: 'find inválido: informe o texto em "text"' };

  const interactive = deepQuerySelectorAll(INTERACTIVE_SELECTOR).filter(isVisible);
  const matches = interactive.filter((el) => {
    const haystack = [
      el.innerText, el.textContent,
      el.getAttribute('aria-label'), el.getAttribute('title'),
      el.getAttribute('placeholder'), el.getAttribute('value'),
      el.getAttribute('name'), el.id,
    ].filter(Boolean).map(normalize);
    return haystack.some((value) => value.includes(query));
  });

  const target = matches[0] || findTextOccurrence(query, 1);
  if (!target) {
    return { ok: false, message: `Nada encontrado na página para "${act.text || act.query}". Tente outro termo ou get_links.` };
  }

  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  await waitForScrollSettle(null);

  const items = matches.slice(0, 10).map((el) => describeElement(el));
  return {
    ok: true,
    message: `Rolou até "${act.text || act.query}". ${matches.length} elemento(s) interativo(s) correspondente(s). A lista de elementos será atualizada no próximo ciclo — use o índice do alvo na lista do system prompt.`,
    data: { count: matches.length, items },
  };
}

function parseKeyCombo(keys) {
  const parts = keys.split('+').map((p) => p.trim()).filter(Boolean);
  const modifiers = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const keyPart = parts[parts.length - 1] || keys;
  const aliases = {
    esc: 'Escape', return: 'Enter', del: 'Delete', space: ' ',
    arrowdown: 'ArrowDown', arrowup: 'ArrowUp', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
    pagedown: 'PageDown', pageup: 'PageUp',
  };
  return {
    key: aliases[keyPart.trim().toLowerCase()] || keyPart.trim(),
    ctrlKey: modifiers.has('control') || modifiers.has('ctrl'),
    metaKey: modifiers.has('meta') || modifiers.has('command') || modifiers.has('cmd'),
    shiftKey: modifiers.has('shift'),
    altKey: modifiers.has('alt') || modifiers.has('option'),
  };
}

function focusAdjacentElement(direction) {
  const focusable = Array.from(document.querySelectorAll(
    "a[href], button, input, textarea, select, [tabindex]:not([tabindex='-1']), [contenteditable='true']"
  )).filter(isVisible);
  if (!focusable.length) return;
  const activeIndex = document.activeElement instanceof HTMLElement ? focusable.indexOf(document.activeElement) : -1;
  const nextIndex = activeIndex === -1
    ? (direction === 1 ? 0 : focusable.length - 1)
    : (activeIndex + direction + focusable.length) % focusable.length;
  if (focusable[nextIndex]) focusable[nextIndex].focus();
}

function applyEditableKey(receiver, key) {
  const start = receiver.selectionStart ?? receiver.value.length;
  const end = receiver.selectionEnd ?? receiver.value.length;
  if (key === 'Backspace') {
    const deleteStart = start === end ? Math.max(0, start - 1) : start;
    receiver.value = receiver.value.slice(0, deleteStart) + receiver.value.slice(end);
    receiver.setSelectionRange(deleteStart, deleteStart);
    receiver.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } else if (key === 'Delete') {
    const deleteEnd = start === end ? Math.min(receiver.value.length, end + 1) : end;
    receiver.value = receiver.value.slice(0, start) + receiver.value.slice(deleteEnd);
    receiver.setSelectionRange(start, start);
    receiver.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
}

function applyContentEditableKey(receiver, key) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !receiver.contains(selection.anchorNode)) return false;
  let range = selection.getRangeAt(0).cloneRange();
  if (range.collapsed) {
    try {
      if (key === 'Backspace') range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
      else range.setEnd(range.endContainer, Math.min(range.endContainer.length ?? range.endOffset + 1, range.endOffset + 1));
    } catch (_) { return false; }
  }
  if (range.collapsed) return false;
  range.deleteContents();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function applyKnownKeyboardEffect(receiver, combo) {
  if ((combo.ctrlKey || combo.metaKey) && combo.key.toLowerCase() === 'a') {
    if (receiver instanceof HTMLInputElement || receiver instanceof HTMLTextAreaElement) {
      receiver.select();
    } else if (receiver.getAttribute('contenteditable') === 'true') {
      const range = document.createRange();
      range.selectNodeContents(receiver);
      const selection = window.getSelection();
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
    }
    return { mutatesText: false, handled: true };
  }
  if (combo.key === 'Tab') {
    focusAdjacentElement(combo.shiftKey ? -1 : 1);
    return { mutatesText: false, handled: true };
  }
  const mutatesText = combo.key === 'Backspace' || combo.key === 'Delete';
  if (receiver instanceof HTMLInputElement || receiver instanceof HTMLTextAreaElement) {
    if (mutatesText) applyEditableKey(receiver, combo.key);
    return { mutatesText, handled: true };
  }
  if (mutatesText && receiver.getAttribute('contenteditable') === 'true') {
    const handled = applyContentEditableKey(receiver, combo.key);
    if (handled) receiver.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return { mutatesText: true, handled };
  }
  return { mutatesText, handled: !mutatesText };
}

function keyToCode(key) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key === ' ') return 'Space';
  return key;
}

async function actionSendKeys(act) {
  const keys = String(act.keys || act.key || '').trim();
  if (!keys) return { ok: false, message: 'send_keys inválido: keys vazio' };
  const targetEl = toTarget(act) ? findTarget(toTarget(act)) : null;
  if (toTarget(act) && !targetEl) return targetNotFound(act, 'Elemento para send_keys');

  const receiver = targetEl ||
    (document.activeElement instanceof HTMLElement ? document.activeElement : document.body);
  receiver.focus();

  const combo = parseKeyCombo(keys);
  const effect = applyKnownKeyboardEffect(receiver, combo);

  const init = {
    bubbles: true, composed: true,
    key: combo.key, code: keyToCode(combo.key),
    ctrlKey: combo.ctrlKey, metaKey: combo.metaKey, shiftKey: combo.shiftKey, altKey: combo.altKey,
  };
  receiver.dispatchEvent(new KeyboardEvent('keydown', init));
  receiver.dispatchEvent(new KeyboardEvent('keyup', init));
  if (effect.mutatesText && !effect.handled) {
    return { ok: true, message: `Teclas enviadas: ${keys} (aviso: elemento contenteditable — não foi possível confirmar a edição de texto; confira o resultado com extract_text)` };
  }
  return { ok: true, message: `Teclas enviadas: ${keys}` };
}

async function actionHover(act) {
  const el = findTarget(toTarget(act));
  if (!el) return targetNotFound(act, 'Elemento para hover');
  await scrollIntoViewIfNeeded(el);
  const rect = el.getBoundingClientRect();
  const base = {
    bubbles: true, cancelable: true, composed: true,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
  };
  for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
    el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, base) : new MouseEvent(type, base));
  }
  return { ok: true, message: `Hover em ${describeElement(el)}` };
}

async function actionFocus(act) {
  const el = findTarget(toTarget(act));
  if (!el) return targetNotFound(act, 'Elemento para focar');
  await scrollIntoViewIfNeeded(el);
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.click();
  return { ok: true, message: 'Elemento focado' };
}

async function actionGetRect(act) {
  const el = findTarget(toTarget(act));
  if (!el) return targetNotFound(act, 'Elemento');
  await scrollIntoViewIfNeeded(el);
  const rect = el.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const hit = document.elementFromPoint(x, y);
  const related = hit && (hit === el || el.contains(hit) || hit.contains(el));
  if (!related) {
    return {
      ok: false,
      message: `Elemento coberto: ${hit ? describeElement(hit) : 'outro elemento'} está NA FRENTE de ${describeElement(el)}. Dispense o overlay/banner primeiro (procure "Fechar"/"Aceitar"/"X" na lista de elementos) ou escolha outro alvo.`,
    };
  }
  return {
    ok: true,
    message: `Elemento localizado: ${describeElement(el)}`,
    data: { x, y },
  };
}

async function actionExtractText(act) {
  let el = resolveForRead(act);
  let text = el ? (el.innerText || el.textContent || '').trim() : '';

  if (!text) {
    await waitForNetworkQuiet(1500);
    await wait(300);
    el = resolveForRead(act) || el;
    text = el ? (el.innerText || el.textContent || '').trim() : '';
  }
  if (!el) return { ok: false, message: `Elemento não encontrado: "${act.selector || ''}". ${summarizeTarget(act)}` };
  return { ok: true, message: 'Texto extraído', data: { text: text.slice(0, 8000) } };
}

// Nestes, o atributo guarda só o valor inicial do HTML e não muda com interação —
// quem reflete o estado atual é a propriedade. Ler o atributo faz um checkbox
// recém-marcado parecer desmarcado.
const STATE_PROPS = {
  checked: 'checked',
  value: 'value',
  disabled: 'disabled',
  selected: 'selected',
  indeterminate: 'indeterminate',
  readonly: 'readOnly',
};

async function actionGetAttribute(act) {
  const el = resolveForRead(act);
  if (!el) return { ok: false, message: `Elemento não encontrado: "${act.selector || ''}"` };
  const name = String(act.attribute || '');
  const prop = STATE_PROPS[name.toLowerCase()];
  if (prop && prop in el) {
    return { ok: true, message: 'Atributo lido', data: { value: el[prop] } };
  }
  return { ok: true, message: 'Atributo lido', data: { value: el.getAttribute(name) } };
}

async function actionGetCss(act) {
  const el = resolveForRead(act);
  if (!el) return { ok: false, message: `Elemento não encontrado: "${act.selector || ''}"` };
  const style = window.getComputedStyle(el);
  if (act.property) return { ok: true, message: 'CSS lido', data: { value: style.getPropertyValue(act.property) } };
  return {
    ok: true, message: 'CSS lido',
    data: {
      value: {
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize,
        width: style.width, height: style.height, position: style.position,
      },
    },
  };
}

async function actionGetLinks(act) {
  const norm = normalize(String(act.filter || ''));
  const collect = () => Array.from(document.querySelectorAll('a[href]'))
    .filter((a) => {
      const t = (a.textContent || '').trim();
      return t.length > 2 && (!norm || a.href.toLowerCase().includes(norm) || normalize(t).includes(norm));
    })
    .slice(0, 200)
    .map((a) => {
      const parent = a.closest('li,article,section,[class*="job"],[class*="vaga"],[class*="card"],[class*="item"]');
      const context = parent ? parent.innerText.replace(/\s+/g, ' ').trim().substring(0, 200) : '';
      return { text: a.textContent.trim().substring(0, 120), href: a.href, context };
    });
  let links = collect();

  if (links.length === 0) {
    await waitForNetworkQuiet(1500);
    await wait(300);
    links = collect();
  }
  return { ok: true, message: `${links.length} link(s) encontrado(s)`, data: { links } };
}

async function actionAssertText(act) {
  const wanted = normalize(String(act.text || ''));
  const el = resolveForRead(act);
  if (act.selector || act.target) {
    if (!el) return { ok: false, message: `Elemento não encontrado para assert_text: "${act.selector || ''}"` };
    const content = normalize(el.innerText || el.textContent || '');
    return content.includes(wanted)
      ? { ok: true, message: `Texto "${act.text}" confirmado em "${act.selector || 'elemento'}"` }
      : { ok: false, message: `Texto "${act.text}" NÃO encontrado em "${act.selector || 'elemento'}". Conteúdo atual: "${(el.innerText || '').trim().slice(0, 200)}"` };
  }
  const bodyText = normalize(document.body ? document.body.innerText : '');
  return bodyText.includes(wanted)
    ? { ok: true, message: `Texto "${act.text}" visível na página` }
    : { ok: false, message: `Texto "${act.text}" NÃO encontrado na página` };
}

async function actionAssertUrlIncludes(act) {
  const ok = location.href.toLowerCase().includes(String(act.part || '').toLowerCase());
  return ok
    ? { ok: true, message: `URL contém "${act.part}"` }
    : { ok: false, message: `URL não contém "${act.part}". URL atual: ${location.href}` };
}

async function actionWaitForSelector(act) {
  const timeout = act.timeout || 7000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const el = document.querySelector(act.selector);
      if (el && isVisible(el)) return { ok: true, message: `Elemento apareceu: ${act.selector}` };
    } catch (e) {
      return { ok: false, message: `Seletor inválido: ${act.selector}` };
    }
    await wait(250);
  }
  return { ok: false, message: `Timeout aguardando selector: ${act.selector}` };
}

async function actionWaitForText(act) {
  const timeout = act.timeout || 7000;
  const needle = normalize(String(act.text || ''));
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (document.body && normalize(document.body.innerText).includes(needle)) {
      return { ok: true, message: `Texto apareceu: ${act.text}` };
    }
    await wait(250);
  }
  return { ok: false, message: `Timeout aguardando texto: ${act.text}` };
}

async function actionGetErrors() {
  const consoleErrors = consoleBuffer.filter((e) => e.level === 'error').slice(-15);
  const networkErrors = networkBuffer.filter((n) => !n.ok || (n.status && n.status >= 400)).slice(-15);
  return {
    ok: true,
    message: `${consoleErrors.length} erro(s) de console, ${networkErrors.length} falha(s) de rede`,
    data: { consoleErrors, networkErrors },
  };
}

function formatNetworkEntry(n) {
  return `${n.method} ${n.url} → ${n.status || n.error || '?'} (${n.duration || '?'})`;
}

async function actionGetNetworkRequests(act) {
  const filter = normalize(String(act.filter || ''));
  const matches = networkBuffer.filter((n) => !filter || (n.url || '').toLowerCase().includes(filter));
  const recent = matches.slice(-30);
  return {
    ok: true,
    message: `${recent.length} requisição(ões)${filter ? ` com "${act.filter}"` : ''} capturadas desde o carregamento`,
    data: { requests: recent.map(formatNetworkEntry) },
  };
}

async function actionAssertNetworkRequest(act) {
  const wanted = normalize(String(act.urlIncludes || ''));
  if (!wanted) return { ok: false, message: 'assert_network_request inválido: informe "urlIncludes"' };
  const deadline = Date.now() + (act.timeout || 5000);
  let matches = [];
  while (Date.now() < deadline) {
    matches = networkBuffer.filter((n) => (n.url || '').toLowerCase().includes(wanted));
    if (matches.length > 0) break;
    await wait(200);
  }
  if (matches.length === 0) {
    return { ok: false, message: `Nenhuma requisição com URL contendo "${act.urlIncludes}" foi capturada. Requisições recentes:\n${networkBuffer.slice(-10).map(formatNetworkEntry).join('\n') || '(nenhuma)'}` };
  }
  const last = matches[matches.length - 1];
  if (act.status !== undefined && act.status !== null) {
    const expected = Number(act.status);
    const found = matches.find((n) => Number(n.status) === expected);
    return found
      ? { ok: true, message: `Requisição confirmada: ${formatNetworkEntry(found)}` }
      : { ok: false, message: `Requisição encontrada mas com status diferente do esperado (${expected}). Última: ${formatNetworkEntry(last)}` };
  }
  return { ok: true, message: `Requisição confirmada: ${formatNetworkEntry(last)}` };
}

// Headers de autenticação vão mascarados por padrão: identificam o esquema e o tamanho
// sem entregar a credencial.
const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization)$/i;

function maskHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!SECRET_HEADER.test(k)) { out[k] = v; continue; }
    const s = String(v);
    const scheme = /^(bearer|basic|digest)\s/i.exec(s);
    out[k] = `${scheme ? scheme[1] + ' ' : ''}${s.slice(scheme ? scheme[0].length : 0, (scheme ? scheme[0].length : 0) + 6)}… (${s.length} chars, mascarado)`;
  }
  return out;
}

function formatHeaderBlock(title, headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return `${title}: (nenhum capturado)`;
  return `${title}:\n${entries.map(([k, v]) => `    ${k}: ${v}`).join('\n')}`;
}

async function actionGetNetworkRequestDetail(act) {
  const wanted = normalize(String(act.urlIncludes || ''));
  if (!wanted) return { ok: false, message: 'get_network_request_detail inválido: informe "urlIncludes"' };
  const matches = networkBuffer.filter((n) => (n.url || '').toLowerCase().includes(wanted));
  if (!matches.length) {
    return {
      ok: false,
      message: `Nenhuma requisição capturada com "${act.urlIncludes}". Só o tráfego fetch/XHR feito DEPOIS que a página carregou com a Bia ativa é capturado — refaça a ação que dispara essa chamada e tente de novo. Recentes:\n${networkBuffer.slice(-10).map(formatNetworkEntry).join('\n') || '(nenhuma)'}`,
    };
  }
  const n = act.occurrence === 'first' ? matches[0] : matches[matches.length - 1];
  const maxBody = Math.min(Number(act.maxBodyChars) || 4000, 8000);

  const lines = [
    `${n.method} ${n.url}`,
    `Status: ${n.status || n.error || '?'} · ${n.ok ? 'OK' : 'FALHOU'} · ${n.duration || '?'} · ${n.type} · ${n.time}`,
    formatHeaderBlock('Request headers', maskHeaders(n.requestHeaders)),
    n.requestBody ? `Request body:\n${n.requestBody.slice(0, maxBody)}` : '',
    formatHeaderBlock('Response headers', maskHeaders(n.responseHeaders)),
  ];
  if (act.includeBody !== false) {
    if (n.body !== undefined) {
      lines.push(`Response body (${n.bodyChars} chars${n.bodyTruncated ? ', truncado na captura' : ''}):\n${String(n.body).slice(0, maxBody)}`);
    } else if (n.bodyDropped) {
      lines.push('Response body: descartado do buffer por ser antigo — refaça a chamada para capturá-lo de novo.');
    } else {
      lines.push('Response body: não capturado (resposta binária, muito grande, ou responseType não textual).');
    }
  }
  return {
    ok: true,
    message: `Detalhe de ${matches.length > 1 ? `${matches.length} correspondências (mostrando a ${act.occurrence === 'first' ? 'primeira' : 'última'})` : '1 requisição'}`,
    data: { detail: lines.filter(Boolean).join('\n') },
  };
}

/* ===== Inspeção nível DevTools (aba Application) =====
   Os valores saem SEMPRE mascarados: a Bia recebe chave, tamanho, tipo e um preview,
   além das claims do JWT quando houver. O valor cru só sai por reveal_secret, que passa
   por confirmação do usuário no painel. */

function decodeJwtClaims(value) {
  try {
    const parts = String(value).split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload || typeof payload !== 'object') return null;
    return {
      sub: payload.sub,
      iss: payload.iss,
      aud: payload.aud,
      scope: payload.scope || payload.scp,
      role: payload.role || payload.roles,
      iat: payload.iat ? new Date(payload.iat * 1000).toISOString() : undefined,
      exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
      expired: payload.exp ? Date.now() / 1000 > payload.exp : undefined,
    };
  } catch (_) { return null; }
}

const SECRETISH_KEY = /token|auth|jwt|bearer|session|secret|api[_-]?key|credential|password|senha/i;

function describeStoredValue(source, key, rawValue) {
  const value = rawValue == null ? '' : String(rawValue);
  const claims = decodeJwtClaims(value);
  const sensitive = claims || SECRETISH_KEY.test(key);
  const entry = {
    source,
    key,
    chars: value.length,
    sensitive,
    // Preview curto o bastante para identificar o valor sem entregá-lo.
    preview: sensitive
      ? `${value.slice(0, 6)}…${value.length > 12 ? value.slice(-4) : ''} (${value.length} chars, mascarado)`
      : value.slice(0, 160) + (value.length > 160 ? '…' : ''),
  };
  if (claims) {
    entry.isJWT = true;
    entry.jwt = claims;
  }
  return entry;
}

function readWebStorage(store, source) {
  const out = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key == null) continue;
      out.push(describeStoredValue(source, key, store.getItem(key)));
    }
  } catch (e) {
    out.push({ source, key: '(erro)', preview: `Sem acesso a ${source}: ${e.message}`, chars: 0, sensitive: false });
  }
  return out;
}

function readJsCookies() {
  if (!document.cookie) return [];
  return document.cookie.split(';').map((chunk) => {
    const [name, ...rest] = chunk.trim().split('=');
    return describeStoredValue('cookie', (name || '').trim(), rest.join('='));
  }).filter((c) => c.key);
}

function rawStoredValue(source, key) {
  try {
    if (source === 'localStorage') return localStorage.getItem(key);
    if (source === 'sessionStorage') return sessionStorage.getItem(key);
    if (source === 'cookie') {
      const hit = document.cookie.split(';')
        .map((c) => c.trim())
        .find((c) => c.slice(0, c.indexOf('=')) === key);
      return hit ? hit.slice(hit.indexOf('=') + 1) : null;
    }
  } catch (_) { /* origem opaca */ }
  return null;
}

async function actionGetStorage(act) {
  const area = String(act.area || 'all');
  const filter = normalize(String(act.filter || ''));
  let entries = [];
  if (area === 'localStorage' || area === 'all') entries.push(...readWebStorage(localStorage, 'localStorage'));
  if (area === 'sessionStorage' || area === 'all') entries.push(...readWebStorage(sessionStorage, 'sessionStorage'));
  if (area === 'cookies' || area === 'cookie' || area === 'all') entries.push(...readJsCookies());
  if (filter) entries = entries.filter((e) => (e.key || '').toLowerCase().includes(filter));

  const shown = entries.slice(0, 60);
  const jwtCount = shown.filter((e) => e.isJWT).length;
  return {
    ok: true,
    message: `${entries.length} entrada(s) em ${area}${filter ? ` com "${act.filter}"` : ''}${entries.length > shown.length ? ` (mostrando ${shown.length})` : ''}${jwtCount ? ` · ${jwtCount} JWT decodificado(s)` : ''}. Valores sensíveis vêm mascarados — use reveal_secret se o usuário pediu o valor completo.`,
    data: { origin: location.origin, entries: shown },
  };
}

// Só devolve o valor cru: quem decide se pode é o gate em background/agent.js.
async function actionReadRawSecret(act) {
  const value = rawStoredValue(String(act.source || ''), String(act.key || ''));
  if (value == null) return { ok: false, message: `Não encontrei "${act.key}" em ${act.source} nesta página.` };
  return { ok: true, message: 'ok', data: { value } };
}

async function actionGetPageDiagnostics() {
  const all = collectQaDebugData();
  return {
    ok: true,
    message: 'Diagnóstico da página coletado (meta, segurança, performance, DOM, acessibilidade).',
    data: {
      page: all.page,
      security: all.security,
      performance: all.performance,
      dom: { ...all.dom, headingStructure: (all.dom?.headingStructure || []).slice(0, 15) },
      accessibility: all.accessibility,
      network: {
        totalResources: all.network?.totalResources,
        totalSize: all.network?.totalSize,
        interceptedErrors: (all.network?.interceptedErrors || []).slice(-10),
      },
    },
  };
}

async function actionWaitForNetworkIdle(act) {
  const maxMs = act.timeout || 5000;
  const start = Date.now();
  await waitForNetworkQuiet(maxMs);
  const waited = Date.now() - start;
  return inflightRequests > 0
    ? { ok: true, message: `Rede ainda ativa após ${maxMs}ms (${inflightRequests} requisição(ões) em voo — pode ser long-polling); prossiga com cautela` }
    : { ok: true, message: `Rede ociosa (aguardou ${waited}ms)` };
}

const ACTION_HANDLERS = {
  click: actionClick,
  type: actionType,
  fill: actionType,
  clear: actionClear,
  press_enter: actionPressEnter,
  select: actionSelect,
  get_dropdown_options: actionGetDropdownOptions,
  select_dropdown_option: actionSelectDropdownOption,
  check_checkbox: actionCheckCheckbox,
  scroll: actionScroll,
  scroll_to: actionScrollTo,
  scroll_to_text: actionScrollToText,
  find: actionFind,
  send_keys: actionSendKeys,
  hover: actionHover,
  focus: actionFocus,
  get_rect: actionGetRect,
  extract_text: actionExtractText,
  get_attribute: actionGetAttribute,
  get_css: actionGetCss,
  get_links: actionGetLinks,
  get_errors: actionGetErrors,
  get_network_requests: actionGetNetworkRequests,
  assert_network_request: actionAssertNetworkRequest,
  wait_for_network_idle: actionWaitForNetworkIdle,
  get_storage: actionGetStorage,
  get_page_diagnostics: actionGetPageDiagnostics,
  get_network_request_detail: actionGetNetworkRequestDetail,
  __read_raw_secret: actionReadRawSecret,
  assert_text: actionAssertText,
  assert_url_includes: actionAssertUrlIncludes,
  wait_for_selector: actionWaitForSelector,
  wait_for_text: actionWaitForText,
  navigate: async (act) => {
    const url = String(act.url || '');
    if (!/^https?:\/\//i.test(url)) return { ok: false, message: `Navegação bloqueada: só http/https é permitido (recebido: "${url.slice(0, 30)}")` };
    window.location.href = url;
    return { ok: true, message: 'Navegação iniciada' };
  },
  wait: async (act) => { await wait(act.ms || 1000); return { ok: true, message: `Aguardou ${act.ms || 1000}ms` }; },
};

async function executeBrowserAction(act) {
  const handler = ACTION_HANDLERS[act.type];
  if (!handler) {
    return { ok: false, message: `Tipo de action desconhecido no content script: "${act.type}"` };
  }
  try {
    return await handler(act);
  } catch (e) {
    return { ok: false, message: `Erro ao executar ${act.type}: ${e.message}` };
  }
}

let recordActive = false;

function describeForRecord(el) {
  const interactive = el.closest(
    'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[contenteditable="true"],label'
  );
  const target = interactive instanceof HTMLElement ? interactive : el;
  return {
    tag: target.tagName.toLowerCase(),
    text: truncate(normalizeText(target.innerText || target.textContent || '') || '', 80) || undefined,
    label: findLabel(target) || undefined,
    placeholder: (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) ? (target.placeholder || undefined) : undefined,
    inputType: target instanceof HTMLInputElement ? target.type : undefined,
    selector: buildBestSelector(target),
  };
}

function sendRecordEvent(event) {
  chrome.runtime.sendMessage({
    action: 'flowQaRecorderEvent',
    event: { ...event, url: location.href, ts: Date.now() },
  }).catch(() => {});
}

const TYPING_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'time']);

function handleRecordClick(e) {
  if (!recordActive) return;
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const desc = describeForRecord(t);
  if (desc.tag === 'input' && TYPING_INPUT_TYPES.has(desc.inputType)) return;
  if (desc.tag === 'textarea' || desc.tag === 'select') return;
  sendRecordEvent({ kind: 'click', el: desc });
}

function handleRecordChange(e) {
  if (!recordActive) return;
  const t = e.target;
  if (t instanceof HTMLSelectElement) {
    const opt = t.options[t.selectedIndex];
    sendRecordEvent({ kind: 'select', el: describeForRecord(t), value: opt ? opt.text : t.value });
    return;
  }
  if (t instanceof HTMLInputElement && (t.type === 'checkbox' || t.type === 'radio')) {
    sendRecordEvent({ kind: 'check', el: describeForRecord(t), checked: t.checked });
    return;
  }
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
    const secret = t instanceof HTMLInputElement && t.type === 'password';
    sendRecordEvent({
      kind: 'input',
      el: describeForRecord(t),
      value: secret ? '{{senha}}' : truncate(String(t.value), 120),
      secret,
    });
  }
}

function handleRecordKeydown(e) {
  if (!recordActive || e.key !== 'Enter') return;
  const el = e.target instanceof HTMLElement ? describeForRecord(e.target) : null;
  sendRecordEvent({ kind: 'enter', el });
}

function enableRecord() {
  if (recordActive) return;
  recordActive = true;
  document.addEventListener('click', handleRecordClick, true);
  document.addEventListener('change', handleRecordChange, true);
  document.addEventListener('keydown', handleRecordKeydown, true);
}

function disableRecord() {
  recordActive = false;
  document.removeEventListener('click', handleRecordClick, true);
  document.removeEventListener('change', handleRecordChange, true);
  document.removeEventListener('keydown', handleRecordKeydown, true);
}

let inspectActive = false;
let inspectOverlay = null;
let highlightedEl = null;

function createInspectOverlay() {
  if (inspectOverlay) return inspectOverlay;
  inspectOverlay = document.createElement('div');
  inspectOverlay.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483647;' +
    'border:2px solid #ff6b00;background:rgba(255,107,0,0.08);' +
    'box-shadow:0 0 0 1px #fff inset;';
  document.documentElement.appendChild(inspectOverlay);
  return inspectOverlay;
}

function showInspectHighlight(el) {
  const o = createInspectOverlay();
  const r = el.getBoundingClientRect();
  o.style.display = 'block';
  o.style.left = `${r.left}px`;
  o.style.top = `${r.top}px`;
  o.style.width = `${r.width}px`;
  o.style.height = `${r.height}px`;
  highlightedEl = el;
}

function clearInspectHighlight() {
  if (inspectOverlay) inspectOverlay.style.display = 'none';
  highlightedEl = null;
}

function buildBestSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
  if (testid) return `[data-testid="${cssStringEscape(testid)}"]`;
  const cy = el.getAttribute('data-cy');
  if (cy) return `[data-cy="${cssStringEscape(cy)}"]`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${cssStringEscape(name)}"]`;
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${cssStringEscape(ariaLabel)}"]`;
  if (el.className && typeof el.className === 'string') {
    const firstClass = el.className.split(/\s+/).filter(Boolean)[0];
    if (firstClass) return `${el.tagName.toLowerCase()}.${CSS.escape(firstClass)}`;
  }
  return el.tagName.toLowerCase();
}

function getInspectedInfo(el) {
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    className: typeof el.className === 'string' ? el.className : undefined,
    text: (el.innerText || el.textContent || '').trim().slice(0, 120),
    role: el.getAttribute('role') || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    dataTestid: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || undefined,
    selector: buildBestSelector(el),
    xpath: buildXPath(el),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
  };
}

function handleInspectClick(e) {
  if (!inspectActive) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  showInspectHighlight(target);
  chrome.runtime.sendMessage({ action: 'flowQaInspectResult', element: getInspectedInfo(target) }).catch(() => {});
}

function handleInspectHover(e) {
  if (!inspectActive) return;
  const t = e.target;
  if (t instanceof HTMLElement && t !== highlightedEl) showInspectHighlight(t);
}

function enableInspect() {
  if (inspectActive) return;
  inspectActive = true;
  document.addEventListener('click', handleInspectClick, true);
  document.addEventListener('mouseover', handleInspectHover, true);
}

function disableInspect() {
  inspectActive = false;
  document.removeEventListener('click', handleInspectClick, true);
  document.removeEventListener('mouseover', handleInspectHover, true);
  clearInspectHighlight();
  if (inspectOverlay) {
    inspectOverlay.remove();
    inspectOverlay = null;
  }
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.action === 'flowQaPing') {
    sendResponse({ ok: true });
    return false;
  }

  if (req.action === 'flowQaScan') {
    waitForNetworkQuiet()
      .then(() => sendResponse({ ok: true, pageState: scanVisibleDom() }))
      .catch((e) => sendResponse({ ok: false, message: e.message }));
    return true;
  }

  if (req.action === 'flowQaSignature') {
    try {
      sendResponse({ ok: true, signature: getPageSignature() });
    } catch (e) {
      sendResponse({ ok: false, message: e.message });
    }
    return false;
  }

  if (req.action === 'flowQaExecute') {
    executeBrowserAction(req.act || {})
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, message: e.message || 'Erro desconhecido' }));
    return true;
  }

  if (req.action === 'flowQaRecordStart') {
    enableRecord();
    sendResponse({ ok: true });
    return false;
  }

  if (req.action === 'flowQaRecordStop') {
    disableRecord();
    sendResponse({ ok: true });
    return false;
  }

  if (req.action === 'flowQaStartInspect') {
    enableInspect();
    sendResponse({ ok: true });
    return false;
  }

  if (req.action === 'flowQaStopInspect') {
    disableInspect();
    sendResponse({ ok: true });
    return false;
  }

  if (req.action === 'flowQaGetContext') {
    sendResponse({
      ok: true,
      context: {
        url: location.href,
        title: document.title,
        elementCount: lastScanByIndex.size || deepQuerySelectorAll(INTERACTIVE_SELECTOR).length,
        consoleErrors: consoleBuffer.filter((e) => e.level === 'error').length,
        networkErrors: networkBuffer.filter((n) => !n.ok || (n.status && n.status >= 400)).length,
        recentConsole: consoleBuffer.slice(-10),
        recentNetwork: networkBuffer.slice(-10),
        capturedAt: new Date().toISOString(),
      },
    });
    return false;
  }

  if (req.action === 'qaDebug') {
    try {
      sendResponse({ success: true, data: collectQaDebugData() });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return false;
  }

  return false;
});

function collectQaDebugData() {
  const data = {};

  data.page = {
    url: location.href,
    title: document.title,
    domain: location.hostname,
    protocol: location.protocol,
    path: location.pathname,
    search: location.search || 'nenhum',
    hash: location.hash || 'nenhum',
    lang: document.documentElement.lang || 'não definido',
    charset: document.characterSet,
    metaDesc: document.querySelector('meta[name="description"]')?.content || '⚠️ não encontrado',
    metaKeywords: document.querySelector('meta[name="keywords"]')?.content || 'não encontrado',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '⚠️ não encontrado',
    viewport: document.querySelector('meta[name="viewport"]')?.content || '⚠️ não encontrado',
    favicon: document.querySelector('link[rel="icon"],link[rel="shortcut icon"]')?.href || 'não encontrado',
    generator: document.querySelector('meta[name="generator"]')?.content || 'não detectado',
    robots: document.querySelector('meta[name="robots"]')?.content || 'não encontrado',
    themeColor: document.querySelector('meta[name="theme-color"]')?.content || 'não encontrado',
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || 'não encontrado',
    ogImage: document.querySelector('meta[property="og:image"]')?.content || 'não encontrado',
    twitterCard: document.querySelector('meta[name="twitter:card"]')?.content || 'não encontrado',
    timestamp: new Date().toISOString(),
  };

  const mixedContentEls = [...document.querySelectorAll('img[src^="http:"],script[src^="http:"],link[href^="http:"],iframe[src^="http:"]')];
  const iframes = [...document.querySelectorAll('iframe')];
  const forms = [...document.querySelectorAll('form')];
  data.security = {
    https: location.protocol === 'https:',
    cspMeta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || 'não encontrado no DOM',
    mixedContent: mixedContentEls.map((el) => el.src || el.href),
    iframes: iframes.map((f) => ({ src: f.src || '(sem src)', sandbox: f.sandbox.value || '⚠️ não sandboxed' })),
    forms: forms.map((f) => ({ action: f.action, method: (f.method || 'get').toUpperCase(), hasCSRF: !!f.querySelector('input[name*="csrf" i],input[name*="token" i]') })),
    externalScripts: [...document.querySelectorAll('script[src]')].filter((s) => s.src && !s.src.includes(location.hostname)).map((s) => s.src),
    referrerPolicy: document.querySelector('meta[name="referrer"]')?.content || 'não encontrado',
  };

  data.cookies = document.cookie
    ? document.cookie.split(';').map((c) => {
        const [name, ...val] = c.trim().split('=');
        return { name: name.trim(), value: val.join('=').substring(0, 120) };
      }).filter((c) => c.name)
    : [];

  data.localStorage = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      data.localStorage[k] = localStorage.getItem(k);
    }
  } catch (e) { data.localStorage = { _error: e.message }; }

  data.sessionStorage = {};
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      data.sessionStorage[k] = sessionStorage.getItem(k);
    }
  } catch (e) { data.sessionStorage = { _error: e.message }; }

  data.tokens = [];
  const tokenPatterns = [/token/i, /auth/i, /jwt/i, /bearer/i, /access_token/i, /refresh_token/i, /id_token/i, /session/i, /api[_-]?key/i, /x-api/i, /credential/i];

  function tryDecodeJWT(val) {
    try {
      const parts = val.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return {
        sub: payload.sub,
        exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
        iat: payload.iat ? new Date(payload.iat * 1000).toISOString() : undefined,
        iss: payload.iss,
        aud: payload.aud,
        name: payload.name,
        email: payload.email,
        role: payload.role || payload.roles,
        expired: payload.exp ? Date.now() / 1000 > payload.exp : undefined,
      };
    } catch (e) { return null; }
  }

  const allKV = [
    ...Object.entries(data.localStorage).map(([k, v]) => ({ src: 'localStorage', k, v })),
    ...Object.entries(data.sessionStorage).map(([k, v]) => ({ src: 'sessionStorage', k, v })),
    ...data.cookies.map((c) => ({ src: 'cookie', k: c.name, v: c.value })),
  ];
  for (const { src, k, v } of allKV) {
    if (!k || !tokenPatterns.some((p) => p.test(k))) continue;
    const decoded = typeof v === 'string' ? tryDecodeJWT(v) : null;
    data.tokens.push({
      source: src,
      key: k,
      preview: (v || '').substring(0, 80) + ((v || '').length > 80 ? '...' : ''),
      isJWT: !!decoded,
      decoded,
    });
  }

  const nav = performance.getEntriesByType('navigation')[0];
  data.performance = {
    loadTime: nav ? Math.round(nav.loadEventEnd - nav.startTime) + 'ms' : 'N/A',
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) + 'ms' : 'N/A',
    ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) + 'ms' : 'N/A',
    domInteractive: nav ? Math.round(nav.domInteractive - nav.startTime) + 'ms' : 'N/A',
    transferSize: nav ? (nav.transferSize / 1024).toFixed(2) + ' KB' : 'N/A',
    decodedSize: nav ? (nav.decodedBodySize / 1024).toFixed(2) + ' KB' : 'N/A',
    type: nav?.type || 'N/A',
  };

  const resources = performance.getEntriesByType('resource');
  const xhrRes = resources.filter((r) => r.initiatorType === 'xmlhttprequest');
  const fetchRes = resources.filter((r) => r.initiatorType === 'fetch');
  data.network = {
    totalResources: resources.length,
    totalSize: (resources.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024).toFixed(2) + ' KB',
    scripts: resources.filter((r) => r.initiatorType === 'script').length,
    styles: resources.filter((r) => r.initiatorType === 'link').length,
    images: resources.filter((r) => r.initiatorType === 'img').length,
    apiCalls: [
      ...xhrRes.map((r) => ({
        type: 'XHR', url: r.name,
        duration: Math.round(r.duration) + 'ms',
        size: (r.transferSize / 1024).toFixed(2) + 'KB',
      })),
      ...fetchRes.map((r) => ({
        type: 'Fetch', url: r.name,
        duration: Math.round(r.duration) + 'ms',
        size: (r.transferSize / 1024).toFixed(2) + 'KB',
      })),
    ],
    intercepted: networkBuffer.slice(),
    interceptedErrors: networkBuffer.filter((l) => !l.ok),
  };

  const inputs = [...document.querySelectorAll('input,textarea,select')];
  const links = [...document.querySelectorAll('a[href]')];
  const images = [...document.querySelectorAll('img')];
  const buttons = [...document.querySelectorAll('button,[role="button"],input[type="submit"]')];
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];

  data.dom = {
    forms: forms.length,
    inputs: inputs.length,
    links: links.length,
    images: images.length,
    buttons: buttons.length,
    headings: headings.length,
    iframes: iframes.length,
    scripts: document.querySelectorAll('script').length,
    totalNodes: document.querySelectorAll('*').length,
    headingStructure: headings.map((h) => ({ tag: h.tagName, text: h.textContent.trim().substring(0, 80) })),
    h1Count: document.querySelectorAll('h1').length,
  };

  const imgsNoAlt = [...document.querySelectorAll('img:not([alt])')];
  const imgsEmptyAlt = [...document.querySelectorAll('img[alt=""]')];
  const btnsNoLabel = [...document.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby') && !b.title);
  const inputsNoLabel = inputs.filter((i) => {
    if (i.type === 'hidden' || i.type === 'submit' || i.type === 'button') return false;
    const id = i.id;
    const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const hasAria = i.getAttribute('aria-label') || i.getAttribute('aria-labelledby');
    const hasPlaceholder = i.placeholder;
    return !hasLabel && !hasAria && !hasPlaceholder;
  });
  const linksNoText = links.filter((a) => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.title);
  const tabIndexWrong = [...document.querySelectorAll('[tabindex]')].filter((el) => parseInt(el.getAttribute('tabindex')) > 0);

  data.accessibility = {
    htmlLang: document.documentElement.lang || '⚠️ não definido',
    imgsWithoutAlt: imgsNoAlt.length,
    imgsWithEmptyAlt: imgsEmptyAlt.length,
    btnsWithoutLabel: btnsNoLabel.length,
    inputsWithoutLabel: inputsNoLabel.length,
    linksWithoutText: linksNoText.length,
    h1Count: data.dom.h1Count,
    hasSkipLink: !!document.querySelector('a[href="#main"],a[href="#content"],a[href="#skip"],a[href="#maincontent"]'),
    hasMainLandmark: !!document.querySelector('main,[role="main"]'),
    hasNavLandmark: !!document.querySelector('nav,[role="navigation"]'),
    positiveTabindex: tabIndexWrong.length,
    focusableElements: document.querySelectorAll('a,button,input,textarea,select,[tabindex]:not([tabindex="-1"])').length,
    details: {
      imgsNoAlt: imgsNoAlt.slice(0, 5).map((i) => i.src?.split('/').pop() || i.className || '(sem src)'),
      btnsNoLabel: btnsNoLabel.slice(0, 5).map((b) => b.className || b.id || '(sem identificador)'),
      inputsNoLabel: inputsNoLabel.slice(0, 5).map((i) => `${i.tagName.toLowerCase()}[name="${i.name || ''}"]`),
    },
  };

  data.errors = consoleBuffer
    .filter((e) => e.level === 'error')
    .map((e) => ({ type: e.type || 'console.error', message: e.message, source: e.source, line: e.line, col: e.col, time: e.time }));

  return data;
}
})();
