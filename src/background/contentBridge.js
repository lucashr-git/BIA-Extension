async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { action: 'flowQaPing' });
    if (pong?.ok) return;
  } catch (_) {
  }

  const nonce = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  const setNonce = (n) => { window.__FLOW_QA_NONCE = n; };

  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: setNonce, args: [nonce] }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/page-hook.js'], world: 'MAIN' }).catch(() => {});

  await chrome.scripting.executeScript({ target: { tabId }, func: setNonce, args: [nonce] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  await new Promise((r) => setTimeout(r, 100));
}

export async function sendToContent(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (_) {
    await ensureContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

export async function scanPage(tabId) {
  const res = await sendToContent(tabId, { action: 'flowQaScan' }).catch(() => null);
  return res?.ok ? res.pageState : null;
}

export async function getPageSignature(tabId) {
  const res = await sendToContent(tabId, { action: 'flowQaSignature' }).catch(() => null);
  return res?.ok ? res.signature : null;
}

export async function executeInContent(tabId, act) {
  const res = await sendToContent(tabId, { action: 'flowQaExecute', act });
  return res || { ok: false, message: 'Sem resposta do content script' };
}

export async function getPageContext(tabId) {
  const res = await sendToContent(tabId, { action: 'flowQaGetContext' }).catch(() => null);
  return res?.ok ? res.context : null;
}

export async function startInspect(tabId) {
  return sendToContent(tabId, { action: 'flowQaStartInspect' });
}

export async function stopInspect(tabId) {
  return sendToContent(tabId, { action: 'flowQaStopInspect' });
}

export function signaturesDiffer(a, b) {
  if (!a || !b) return false;
  return a.url !== b.url || a.title !== b.title ||
    Math.abs((a.elementCount || 0) - (b.elementCount || 0)) > 3 ||
    a.textHash !== b.textHash;
}

export function describeSignatureChange(before, after) {
  if (!before || !after) return '';
  const changes = [];
  if (before.url !== after.url) changes.push(`URL mudou: ${before.url} → ${after.url}`);
  if (before.title !== after.title) changes.push(`título mudou: "${before.title}" → "${after.title}"`);
  const delta = (after.elementCount || 0) - (before.elementCount || 0);
  if (Math.abs(delta) > 3) changes.push(`${Math.abs(delta)} elementos interativos ${delta > 0 ? 'apareceram' : 'sumiram'}`);
  if (before.textHash !== after.textHash && changes.length === 0) changes.push('conteúdo de texto da página mudou');
  return changes.join('; ');
}
