import { withCDP, cdpClearAndType, cdpPressKey, cdpClick } from './cdp.js';
import { waitForLoad, captureScreen } from './page.js';
import { executeInContent, getPageSignature, signaturesDiffer, describeSignatureChange } from './contentBridge.js';
import { liveLabel } from '../shared/actionLabels.js';
import { runAxeAudit, formatAxeViolations } from './axe.js';

const CONTENT_ACTIONS = new Set([
  'click', 'fill', 'clear', 'press_enter', 'select',
  'get_dropdown_options', 'select_dropdown_option', 'check_checkbox',
  'scroll', 'scroll_to', 'scroll_to_text', 'find', 'send_keys', 'hover',
  'extract_text', 'get_attribute', 'get_css', 'get_links', 'get_errors',
  'get_network_requests', 'assert_network_request', 'wait_for_network_idle',
  'assert_text', 'assert_url_includes', 'wait_for_selector', 'wait_for_text',
  'get_storage', 'get_page_diagnostics',
  // get_network_request_detail é despachada no background (agent.js): junta o que o hook
  // de fetch/XHR viu com a captura do CDP, que enxerga headers do navegador e preflight.
]);

const NAVIGATION_ACTIONS = new Set(['click', 'navigate', 'press_enter', 'go_back', 'search', 'select', 'select_dropdown_option']);

function isNavigationAction(act) {
  if (NAVIGATION_ACTIONS.has(act.type)) return true;
  if (act.type === 'key' && act.key === 'Enter') return true;
  if (act.type === 'send_keys' && /(^|\+)\s*(enter|return)\s*$/i.test(String(act.keys || act.key || ''))) return true;
  return false;
}

function contentResultValue(act, data) {
  if (!data) return undefined;
  if (act.type === 'get_links') return data.links || [];
  if (act.type === 'get_network_requests') return (data.requests || []).join('\n') || 'Nenhuma requisição capturada';
  if (act.type === 'extract_text') return data.text || '(vazio — o elemento não contém texto)';
  if (act.type === 'get_attribute') return data.value === null ? 'null (atributo ausente)' : String(data.value);
  if (act.type === 'get_css') return typeof data.value === 'object' ? JSON.stringify(data.value, null, 2) : String(data.value);
  if (act.type === 'get_dropdown_options') {
    return (data.options || []).map((o) => `[${o.index}] "${o.text}" (value="${o.value}")${o.selected ? ' ← selecionada' : ''}`).join('\n');
  }
  if (act.type === 'get_errors') {
    const c = (data.consoleErrors || []).map((e) => `[console] ${e.message}`).join('\n');
    const n = (data.networkErrors || []).map((e) => `[rede] ${e.method} ${e.url} → ${e.status || e.error || 'FALHOU'}`).join('\n');
    return [c, n].filter(Boolean).join('\n') || 'Nenhum erro de console ou rede detectado';
  }
  if (act.type === 'get_storage') {
    const lines = (data.entries || []).map((e) => {
      const jwt = e.jwt
        ? `\n    JWT → sub=${e.jwt.sub ?? '?'} iss=${e.jwt.iss ?? '?'} exp=${e.jwt.exp ?? '?'}${e.jwt.expired === true ? ' ⚠️ EXPIRADO' : e.jwt.expired === false ? ' (válido)' : ''}${e.jwt.role ? ` role=${JSON.stringify(e.jwt.role)}` : ''}${e.jwt.scope ? ` scope=${e.jwt.scope}` : ''}`
        : '';
      return `[${e.source}] ${e.key} = ${e.preview}${jwt}`;
    });
    return `Origem: ${data.origin}\n${lines.join('\n') || '(vazio)'}`;
  }
  if (act.type === 'get_page_diagnostics') return JSON.stringify(data, null, 1);
  if (act.type === 'get_network_request_detail') return data.detail || '(sem detalhe)';
  if (act.type === 'check_checkbox') return `checked=${data.checked}`;
  if (act.type === 'find') {
    const items = (data.items || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    return `${data.count} correspondência(s)${items ? ':\n' + items : ''}`;
  }
  return undefined;
}

async function handleNewTabAfterClick(tabId, beforeIds) {
  await new Promise((r) => setTimeout(r, 400));
  const after = await chrome.tabs.query({});
  const newTabs = after.filter((t) => !beforeIds.has(t.id) && t.openerTabId === tabId);
  if (newTabs.length === 0) return null;

  const newTab = newTabs[0];
  await waitForLoad(newTab.id, 10000).catch(() => {});

  const freshTab = await new Promise((r) =>
    chrome.tabs.get(newTab.id, (t) => r(chrome.runtime.lastError ? null : t))
  );
  const newUrl = freshTab?.url || freshTab?.pendingUrl || newTab.url || newTab.pendingUrl || '';
  if (!newUrl || !/^https?:\/\//i.test(newUrl)) return null;

  await chrome.tabs.update(newTab.id, { active: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));

  return newTab.id;
}

export async function runActionsWithStatus(tabId, actions, notifyStatus) {
  const executed = [];
  let pageChangedMidBatch = '';
  let newTabId = null;

  let signatureBefore = actions.length > 1 ? await getPageSignature(tabId) : null;

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    const label = liveLabel(act);
    if (notifyStatus) notifyStatus(label);

    try {
      if (CONTENT_ACTIONS.has(act.type)) {
        let beforeIds = null;
        if (act.type === 'click') {
          const before = await chrome.tabs.query({});
          beforeIds = new Set(before.map((t) => t.id));
        }

        let res;
        if (act.type === 'click' && act.trusted) {
          res = await withCDP(tabId, async () => {
            await new Promise((r) => setTimeout(r, 350));
            const rectRes = await executeInContent(tabId, { type: 'get_rect', target: act.target, selector: act.selector });
            if (!rectRes.ok) return rectRes;
            const { x, y } = rectRes.data;
            await cdpClick(tabId, x, y);
            return { ok: true, message: `Click confiável (CDP) em (${x}, ${y})` };
          });
        } else {
          res = await executeInContent(tabId, act);
        }
        if (!res.ok) throw new Error(res.message || `Falha ao executar ${act.type}`);

        if (isNavigationAction(act)) {
          await waitForLoad(tabId, 8000);
          if (beforeIds) {
            const switched = await handleNewTabAfterClick(tabId, beforeIds);
            if (switched) newTabId = switched;
          }
        }

        const value = contentResultValue(act, res.data);
        executed.push({
          ...act,
          done: true,
          result: value !== undefined ? value : res.message,
        });
      } else if (act.type === 'navigate') {
        const res = await executeInContent(tabId, { type: 'navigate', url: act.url });
        if (!res.ok) throw new Error(res.message || 'Falha ao navegar');
        await waitForLoad(tabId, 8000);
        executed.push({ ...act, done: true });
      } else if (act.type === 'go_back') {
        await new Promise((resolve, reject) =>
          chrome.tabs.goBack(tabId, () =>
            chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()
          )
        );
        await waitForLoad(tabId, 8000);
        executed.push({ ...act, done: true });
      } else if (act.type === 'type') {
        if (act.target || act.selector) {
          const focusRes = await executeInContent(tabId, { type: 'focus', target: act.target, selector: act.selector });
          if (!focusRes.ok) throw new Error(focusRes.message || 'Campo não encontrado para digitar');
          await new Promise((r) => setTimeout(r, 150));
        }
        await withCDP(tabId, async () => {
          await cdpClearAndType(tabId, act.text || '');
        });
        await new Promise((r) => setTimeout(r, 200));
        executed.push({ ...act, done: true });
      } else if (act.type === 'search') {
        const sels = ['input[name="q"]', 'input[type="search"]', 'textarea[name="q"]', '[role="searchbox"]',
          'input[placeholder*="busca" i]', 'input[placeholder*="search" i]',
          'input[aria-label*="busca" i]', 'input[aria-label*="search" i]'];
        let focused = false;
        for (const sel of sels) {
          const res = await executeInContent(tabId, { type: 'focus', selector: sel }).catch(() => null);
          if (res?.ok) { focused = true; break; }
        }
        if (!focused) {
          const res = await executeInContent(tabId, {
            type: 'focus',
            selector: 'input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,[contenteditable]',
          }).catch(() => null);
          focused = !!res?.ok;
        }
        if (!focused) throw new Error('Campo de busca não encontrado');
        await new Promise((r) => setTimeout(r, 200));
        await withCDP(tabId, async () => {
          await cdpClearAndType(tabId, act.text || '');
          await new Promise((r) => setTimeout(r, 300));
          await cdpPressKey(tabId, 'Enter');
        });
        await waitForLoad(tabId, 8000);
        executed.push({ ...act, done: true });
      } else if (act.type === 'key') {
        await withCDP(tabId, async () => {
          await cdpPressKey(tabId, act.key);
          if (act.key === 'Enter') await waitForLoad(tabId, 5000);
        });
        executed.push({ ...act, done: true });
      } else if (act.type === 'wait') {
        await new Promise((r) => setTimeout(r, act.ms || 1000));
        executed.push({ ...act, done: true });
      } else if (act.type === 'screenshot') {
        const data = await captureScreen(tabId);
        if (!data) {
          executed.push({ ...act, done: false, error: 'Captura falhou (nem em foco nem via CDP — o DevTools pode estar aberto na aba testada). Feche o DevTools ou descreva a evidência por texto (get_errors/extract_text).' });
        } else {
          executed.push({
            ...act, done: true, screenshotData: data,
            result: 'Screenshot capturada — você a verá incluída visualmente no contexto desta mensagem',
          });
        }
      } else if (act.type === 'accessibility_audit') {
        const violations = await runAxeAudit(tabId);
        executed.push({ ...act, done: true, result: formatAxeViolations(violations) });

      } else {
        throw new Error(`Tipo de action desconhecido: "${act.type}". Use apenas os tipos listados no system prompt.`);
      }
    } catch (e) {
      executed.push({ ...act, error: e.message });
    }

    if (i < actions.length - 1) {
      const signatureAfter = await getPageSignature(tabId).catch(() => null);
      if (signatureBefore && signatureAfter && signaturesDiffer(signatureBefore, signatureAfter)) {
        if (!isNavigationAction(act)) {
          pageChangedMidBatch = describeSignatureChange(signatureBefore, signatureAfter);
          const skipped = actions.slice(i + 1);
          for (const s of skipped) {
            executed.push({ ...s, error: 'Cancelada: a página mudou após a ação anterior — replaneje com o novo estado' });
          }
          break;
        }
      }
      signatureBefore = signatureAfter || signatureBefore;
    }
  }

  return { executed, pageChangedMidBatch, newTabId };
}
