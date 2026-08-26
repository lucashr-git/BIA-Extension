import { attachedTabs } from './state.js';

export async function cdp(tabId, method, params = {}) {
  return new Promise((res, rej) =>
    chrome.debugger.sendCommand({ tabId }, method, params, result =>
      chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(result)
    )
  );
}

function rawAttach(tabId) {
  return new Promise((res, rej) =>
    chrome.debugger.attach({ tabId }, '1.3', () =>
      chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res()
    )
  );
}

const attachInFlight = new Map();

export function cdpAttach(tabId) {
  if (attachedTabs.has(tabId)) return Promise.resolve();
  const inFlight = attachInFlight.get(tabId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      await rawAttach(tabId);
    } catch (_) {
      await new Promise(r => chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; r(); }));
      await new Promise(r => setTimeout(r, 100));
      try {
        await rawAttach(tabId);
      } catch (e) {
        throw new Error(`Não foi possível anexar o controle de teclado/mouse (${e.message}). Se o DevTools estiver aberto na aba testada, feche-o e tente novamente.`);
      }
    }
    attachedTabs.add(tabId);
    await cdp(tabId, 'Page.enable').catch(() => {});
  })().finally(() => attachInFlight.delete(tabId));

  attachInFlight.set(tabId, promise);
  return promise;
}

export async function cdpDetach(tabId) {
  if (!attachedTabs.has(tabId)) return;
  await new Promise(r => chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; attachedTabs.delete(tabId); r(); }));
}

export async function withCDP(tabId, fn) {
  await cdpAttach(tabId);
  return fn(tabId);
}

let platformOS = null;
async function getOS() {
  if (!platformOS) {
    platformOS = await new Promise((r) => chrome.runtime.getPlatformInfo((info) => r(info?.os || 'linux')));
  }
  return platformOS;
}

export async function cdpClearAndType(tabId, text) {
  const modifiers = (await getOS()) === 'mac' ? 4 : 2;
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', keyCode: 65, modifiers, commands: ['selectAll'] });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',   key: 'a', code: 'KeyA', keyCode: 65, modifiers });
  await new Promise(r => setTimeout(r, 40));
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', keyCode: 8 });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Backspace', code: 'Backspace', keyCode: 8 });
  await new Promise(r => setTimeout(r, 40));
  await cdp(tabId, 'Input.insertText', { text });
}

if (chrome.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source && source.tabId != null) attachedTabs.delete(source.tabId);
  });
}

export async function cdpClick(tabId, x, y) {
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await new Promise(r => setTimeout(r, 40));
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await new Promise(r => setTimeout(r, 40));
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

export async function cdpPressKey(tabId, key) {
  const keyMap = {
    Enter:     { key: 'Enter',     code: 'Enter',     keyCode: 13 },
    Escape:    { key: 'Escape',    code: 'Escape',    keyCode: 27 },
    Tab:       { key: 'Tab',       code: 'Tab',       keyCode: 9  },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8  },
    Delete:    { key: 'Delete',    code: 'Delete',    keyCode: 46 },
    Space:     { key: ' ',         code: 'Space',     keyCode: 32 },
    Home:      { key: 'Home',      code: 'Home',      keyCode: 36 },
    End:       { key: 'End',       code: 'End',       keyCode: 35 },
    PageUp:    { key: 'PageUp',    code: 'PageUp',    keyCode: 33 },
    PageDown:  { key: 'PageDown',  code: 'PageDown',  keyCode: 34 },
    ArrowUp:   { key: 'ArrowUp',   code: 'ArrowUp',   keyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    ArrowRight:{ key: 'ArrowRight',code: 'ArrowRight',keyCode: 39 },
  };
  const k = keyMap[key] || { key, code: key, keyCode: 0 };
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await new Promise(r => setTimeout(r, 40));
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp',   ...k });
}

export async function cdpStartScreencast(tabId) {
  await cdpAttach(tabId);
  await cdp(tabId, 'Page.startScreencast', {
    format: 'jpeg', quality: 70, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1,
  });
}

export async function cdpStopScreencast(tabId) {
  if (!attachedTabs.has(tabId)) return;
  await cdp(tabId, 'Page.stopScreencast').catch(() => {});
}

// Os eventos de rede têm o listener próprio em netlog.js — assim cdp.js não precisa
// importá-lo, e o ciclo de imports entre os dois deixa de existir.
if (chrome.debugger?.onEvent) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method !== 'Page.screencastFrame' || source.tabId == null) return;
    chrome.runtime.sendMessage({ action: 'screencastFrame', tabId: source.tabId, data: params.data }).catch(() => {});
    chrome.debugger.sendCommand({ tabId: source.tabId }, 'Page.screencastFrameAck', { sessionId: params.sessionId }, () => {
      void chrome.runtime.lastError;
    });
  });
}
