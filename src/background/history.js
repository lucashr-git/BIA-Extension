import { appendHistory } from '../shared/insights.js';

export async function recordRuns(entries) {
  if (!entries || entries.length === 0) return;
  try {
    const r = await chrome.storage.local.get(['runHistory']);
    await chrome.storage.local.set({ runHistory: appendHistory(r.runHistory || [], entries) });
  } catch (_) {}
}
