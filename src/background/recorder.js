import { sendToContent } from './contentBridge.js';

const sessions = new Map();

export function isRecording(tabId) {
  return sessions.has(tabId);
}

export function recordingCount(tabId) {
  return sessions.get(tabId)?.events.length || 0;
}

export async function startRecording(tabId, url) {
  const events = [];
  if (url) events.push({ kind: 'navigate', url, ts: Date.now() });
  sessions.set(tabId, { events, lastUrl: url || '' });
  try {
    await sendToContent(tabId, { action: 'flowQaRecordStart' });
  } catch (e) {
    sessions.delete(tabId);
    throw e;
  }
  await chrome.storage.session.set({ recorderState: { tabId, startedAt: Date.now() } }).catch(() => {});
}

export async function stopRecording(tabId) {
  const session = sessions.get(tabId);
  sessions.delete(tabId);
  await chrome.storage.session.remove('recorderState').catch(() => {});
  try {
    await sendToContent(tabId, { action: 'flowQaRecordStop' });
  } catch (_) {}
  return session ? session.events : [];
}

export function addRecorderEvent(tabId, event) {
  const session = sessions.get(tabId);
  if (!session || !event || !event.kind) return 0;
  if (event.url && session.lastUrl && event.url !== session.lastUrl) {
    session.events.push({ kind: 'navigate', url: event.url, ts: event.ts || Date.now() });
    session.lastUrl = event.url;
  }
  session.events.push(event);
  if (session.events.length > 300) session.events.shift();
  return session.events.length;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const session = sessions.get(tabId);
  if (!session) return;
  if (changeInfo.url && changeInfo.url !== session.lastUrl) {
    session.events.push({ kind: 'navigate', url: changeInfo.url, ts: Date.now() });
    session.lastUrl = changeInfo.url;
  }
  if (changeInfo.status === 'complete') {
    sendToContent(tabId, { action: 'flowQaRecordStart' }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (sessions.has(tabId)) {
    sessions.delete(tabId);
    chrome.storage.session.remove('recorderState').catch(() => {});
  }
});
