export const attachedTabs = new Set();

const credentialSessions = new Map();

function newCredentialSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `credential-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clearCredentialSessionArtifacts(credentialSessionId) {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
  try {
    chrome.storage.session.get(['pendingConfirm', 'runState', 'chatRunState', 'batchState'])
      .then((stored) => {
        const keys = ['pendingConfirm', 'runState', 'chatRunState', 'batchState']
          .filter((key) => stored[key]?.credentialSessionId === credentialSessionId);
        if (keys.length) chrome.storage.session.remove(keys).catch(() => {});
      })
      .catch(() => {});
  } catch (_) {}
}

// O Chrome não popula sender.documentId em páginas de extensão — o side panel é uma —
// só em frames de conteúdo. Exigi-lo aqui rejeitava TODO login, com qualquer credencial.
// Vira vínculo best-effort: normalizado para '' quando ausente, e comparado do mesmo
// jeito nos dois lados. Quem prende a sessão de fato é o par senderUrl (fixo em
// sidepanel.html, checado no onConnect) + o id de sessão aleatório.
const normalizeDocumentId = (value) => (typeof value === 'string' ? value : '');

export function createCredentialSession(port, documentId, senderUrl, apiKey) {
  if (!port || typeof senderUrl !== 'string' || !senderUrl || typeof apiKey !== 'string' || !apiKey.trim()) {
    return null;
  }
  const credentialSessionId = newCredentialSessionId();
  credentialSessions.set(credentialSessionId, {
    port,
    documentId: normalizeDocumentId(documentId),
    senderUrl,
    apiKey: apiKey.trim(),
    connected: true,
    tasks: new Set(),
  });
  return credentialSessionId;
}

export function requireCredentialSession(req, sender) {
  const credentialSessionId = typeof req?.credentialSessionId === 'string'
    ? req.credentialSessionId
    : '';
  const session = credentialSessions.get(credentialSessionId);
  if (!session || !session.connected || session.documentId !== normalizeDocumentId(sender?.documentId) || session.senderUrl !== sender?.url || !session.port) {
    return { error: 'credential_required' };
  }
  return { credentialSessionId, apiKey: session.apiKey };
}

export function registerCredentialTask(credentialSessionId, cancel) {
  const session = credentialSessions.get(credentialSessionId);
  if (!session?.connected || typeof cancel !== 'function') return null;
  const task = { cancel };
  session.tasks.add(task);
  return () => session.tasks.delete(task);
}

export function invalidateCredentialSession(credentialSessionId) {
  const session = credentialSessions.get(credentialSessionId);
  if (!session) return false;

  // Invalidate and drop the key before cancelling work so no new task can use it.
  session.connected = false;
  credentialSessions.delete(credentialSessionId);
  session.apiKey = null;
  clearCredentialSessionArtifacts(credentialSessionId);
  cancelConfirmationsForCredentialSession(credentialSessionId);
  const tasks = [...session.tasks];
  session.tasks.clear();
  for (const task of tasks) {
    try { task.cancel(); } catch (_) {}
  }
  return true;
}

export function invalidateCredentialSessionsForPort(port) {
  for (const [credentialSessionId, session] of credentialSessions) {
    if (session.port === port) invalidateCredentialSession(credentialSessionId);
  }
}

export async function configureTrustedCredentialStorage(setAccessLevel) {
  try {
    await setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    return true;
  } catch (_) {
    return false;
  }
}

const sessionLogs = new Map();
const cancelledSessions = new Set();
const activeAborts = new Map();

export function cancelAgentLoop(tabId) {
  cancelledSessions.add(tabId);
  const controller = activeAborts.get(tabId);
  if (controller) { try { controller.abort(); } catch (_) {} }
}
export function clearCancelFlag(tabId) { cancelledSessions.delete(tabId); }
export function isAgentCancelled(tabId) { return cancelledSessions.has(tabId); }

export function registerAbort(tabId, controller) { activeAborts.set(tabId, controller); }
export function clearAbort(tabId, controller) {
  if (activeAborts.get(tabId) === controller) activeAborts.delete(tabId);
}

const runningLoops = new Set();
export function isLoopRunning(tabId) { return runningLoops.has(tabId); }
export function anyLoopRunning() { return runningLoops.size > 0; }
export function markLoopRunning(tabId) { runningLoops.add(tabId); }
export function markLoopStopped(tabId) {
  runningLoops.delete(tabId);
  cancelledSessions.delete(tabId);
  activeAborts.delete(tabId);
  loopCurrentTabs.delete(tabId);
}

const loopCurrentTabs = new Map();
export function setLoopCurrentTab(initialTabId, currentTabId) {
  loopCurrentTabs.set(initialTabId, currentTabId);
}
export function findLoopByCurrentTab(tabId) {
  for (const [initialTabId, currentTabId] of loopCurrentTabs) {
    if (currentTabId === tabId) return initialTabId;
  }
  return null;
}

export function cancelAllAgentLoops() {
  for (const tabId of runningLoops) cancelAgentLoop(tabId);
}

export function clearTabState(tabId) {
  sessionLogs.delete(tabId);
  cancelledSessions.delete(tabId);
  activeAborts.delete(tabId);
  runningLoops.delete(tabId);
  attachedTabs.delete(tabId);
  loopCurrentTabs.delete(tabId);
}

export function getSessionLog(tabId) {
  if (!sessionLogs.has(tabId)) sessionLogs.set(tabId, []);
  return sessionLogs.get(tabId);
}

export function addToSessionLog(tabId, { url, title, note }) {
  const log = getSessionLog(tabId);
  const last = log[log.length - 1];
  if (last?.url === url && !note) return;
  log.push({ url, title: title || url, note: note || '', ts: new Date().toLocaleTimeString('pt-BR') });
  if (log.length > 20) log.shift();
}

export function clearSession(tabId) {
  sessionLogs.delete(tabId);
}

const pendingConfirmations = new Map();

export function createConfirmation(id, tabId, credentialSessionId, timeoutMs = 120000) {
  if (typeof credentialSessionId === 'number') {
    timeoutMs = credentialSessionId;
    credentialSessionId = undefined;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingConfirmations.delete(id);
      resolve({ approved: false, timedOut: true });
    }, timeoutMs);
    pendingConfirmations.set(id, { resolve, timer, tabId, credentialSessionId });
  });
}

export function resolveConfirmation(id, approved) {
  const pending = pendingConfirmations.get(id);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingConfirmations.delete(id);
  pending.resolve({ approved: !!approved, timedOut: false });
  return true;
}

export function cancelAllConfirmations() {
  for (const [id, pending] of pendingConfirmations) {
    clearTimeout(pending.timer);
    pending.resolve({ approved: false, timedOut: false, cancelled: true });
    pendingConfirmations.delete(id);
  }
}

export function cancelConfirmationsForTab(tabId) {
  for (const [id, pending] of pendingConfirmations) {
    if (pending.tabId !== tabId) continue;
    clearTimeout(pending.timer);
    pending.resolve({ approved: false, timedOut: false, cancelled: true });
    pendingConfirmations.delete(id);
  }
}

export function cancelConfirmationsForCredentialSession(credentialSessionId) {
  for (const [id, pending] of pendingConfirmations) {
    if (pending.credentialSessionId !== credentialSessionId) continue;
    clearTimeout(pending.timer);
    pending.resolve({ approved: false, timedOut: false, cancelled: true });
    pendingConfirmations.delete(id);
  }
}
