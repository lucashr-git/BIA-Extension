export function notifyStatus(text) {
  chrome.runtime.sendMessage({ action: 'agentStatus', text }).catch(() => {});

  chrome.storage.session.set({ runHeartbeat: { updatedAt: Date.now(), lastStatus: text } }).catch(() => {});
}
