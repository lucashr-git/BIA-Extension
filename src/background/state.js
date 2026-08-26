export const attachedTabs = new Set();

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

export function createConfirmation(id, tabId, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingConfirmations.delete(id);
      resolve({ approved: false, timedOut: true });
    }, timeoutMs);
    pendingConfirmations.set(id, { resolve, timer, tabId });
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
