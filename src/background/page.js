import { withCDP, cdp, cdpDetach } from './cdp.js';
import { attachedTabs } from './state.js';

async function captureViaCdp(tabId) {
  const wasAttached = attachedTabs.has(tabId);
  try {
    return await withCDP(tabId, async () => {
      const res = await cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      return res?.data || null;
    });
  } catch (_) {
    return null;
  } finally {
    if (!wasAttached) cdpDetach(tabId).catch(() => {});
  }
}

export async function captureScreen(tabId) {
  const grab = (windowId) => new Promise(resolve => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }, data => {
      if (chrome.runtime.lastError || !data) resolve(null);
      else resolve(data.replace(/^data:image\/jpeg;base64,/, ''));
    });
  });

  if (typeof tabId === 'number') {
    const tab = await new Promise(r => chrome.tabs.get(tabId, t => r(chrome.runtime.lastError ? null : t)));
    if (!tab) return null;
    if (tab.active) {
      const data = await grab(tab.windowId);
      if (data) return data;
    }
    return captureViaCdp(tabId);
  }
  return grab(null);
}

export async function getPageText(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const skip = new Set(['script','style','noscript','svg','iframe','head','meta','link']);
        let text = '';
        function walk(node) {
          if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) text += t + ' '; return; }
          if (node.nodeType !== 1) return;
          if (skip.has(node.tagName.toLowerCase())) return;
          for (const c of node.childNodes) walk(c);
        }
        walk(document.body);
        return {
          success: true,
          title: document.title,
          url: location.href,
          content: text.replace(/\s+/g,' ').trim().substring(0, 30000)
        };
      }
    });
    return results?.[0]?.result || null;
  } catch(e) {
    return null;
  }
}

export function waitForLoad(tabId, timeout = 8000) {
  return new Promise(resolve => {
    const start = Date.now();

    const settle = () => setTimeout(resolve, 500);
    function check() {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) { resolve(); return; }
        if (tab?.status === 'complete') { settle(); return; }
        if (Date.now() - start > timeout) { resolve(); return; }
        setTimeout(check, 200);
      });
    }
    check();
  });
}
