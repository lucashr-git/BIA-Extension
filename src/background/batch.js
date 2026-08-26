import { agentLoop } from './agent.js';
import { recordRuns } from './history.js';

let batchCancelled = false;
let batchRunning = false;

export function isBatchRunning() {
  return batchRunning;
}

export function cancelBatch() {
  batchCancelled = true;
}

async function saveBatchState(state) {
  await chrome.storage.session.set({ batchState: { ...state, updatedAt: Date.now() } }).catch(() => {});
}

async function savePartial(results, startedAt) {
  await chrome.storage.session.set({
    lastBatch: { results: results.filter(Boolean), startedAt, partial: true },
  }).catch(() => {});
}

async function runItem(tabId, item, settings) {
  const itemStart = Date.now();
  let result;
  try {
    result = await agentLoop({
      tabId,
      messages: [{ role: 'user', content: item.prompt }],
      apiKey: settings.apiKey,
      model: settings.model,
      gatewayUrl: settings.gatewayUrl || '',
      maxSteps: settings.maxSteps,
      features: { ...(settings.featureFlags || {}), videoRecording: false },
      lang: settings.language === 'en' ? 'en' : 'pt',
    });
  } catch (e) {
    result = { error: e.message, actionsExecuted: [] };
  }
  return {
    entry: {
      name: item.name,
      prompt: item.prompt,
      testId: item.testId || null,
      env: item.env || null,
      status: result.finishStatus || (result.error ? 'failed' : null),
      reply: result.reply || '',
      error: result.error || null,
      actionsExecuted: result.actionsExecuted || [],
      durationMs: Date.now() - itemStart,
    },
    finalTabId: result.tabId || tabId,
  };
}

function createTab(url) {
  return new Promise((resolve, reject) =>
    chrome.tabs.create({ url, active: false }, (tab) =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(tab)
    )
  );
}

function removeTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function runSequential({ tabId, items, settings, results, startedAt }) {
  let currentTabId = tabId;
  for (let i = 0; i < items.length; i++) {
    if (batchCancelled) break;
    const item = items[i];
    await saveBatchState({ status: 'running', total: items.length, done: i, current: item.name, startedAt });
    chrome.runtime.sendMessage({ action: 'batchProgress', index: i, total: items.length, name: item.name }).catch(() => {});
    const { entry, finalTabId } = await runItem(currentTabId, item, settings);
    currentTabId = finalTabId;
    results[i] = entry;
    await savePartial(results, startedAt);
  }
}

async function runParallel({ tabId, items, settings, results, startedAt, parallel }) {
  const baseTab = await new Promise((r) => chrome.tabs.get(tabId, (t) => r(chrome.runtime.lastError ? null : t)));
  const baseUrl = baseTab?.url;
  if (!baseUrl) throw new Error('Aba base não encontrada para a execução paralela');

  let nextIndex = 0;
  let done = 0;

  const worker = async () => {
    for (;;) {
      if (batchCancelled || nextIndex >= items.length) return;
      const i = nextIndex++;
      const item = items[i];
      chrome.runtime.sendMessage({ action: 'batchProgress', index: i, total: items.length, name: item.name }).catch(() => {});

      let tab;
      try {
        tab = await createTab(baseUrl);
      } catch (e) {
        results[i] = { name: item.name, prompt: item.prompt, testId: item.testId || null, env: item.env || null, status: 'failed', reply: '', error: `Não foi possível abrir aba paralela: ${e.message}`, actionsExecuted: [], durationMs: 0 };
        done++;
        await saveBatchState({ status: 'running', total: items.length, done, current: item.name, startedAt });
        await savePartial(results, startedAt);
        continue;
      }

      let outcome = null;
      try {
        outcome = await runItem(tab.id, item, settings);
        results[i] = outcome.entry;
      } finally {
        await removeTab(tab.id);
        if (outcome && outcome.finalTabId !== tab.id) await removeTab(outcome.finalTabId);
      }

      done++;
      await saveBatchState({ status: 'running', total: items.length, done, current: item.name, startedAt });
      await savePartial(results, startedAt);
    }
  };

  const workerCount = Math.max(1, Math.min(parallel, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export async function runBatch({ tabId, items, settings, parallel = 1 }) {
  batchRunning = true;
  batchCancelled = false;
  const startedAt = Date.now();
  const results = new Array(items.length);

  try {
    await saveBatchState({ status: 'running', total: items.length, done: 0, current: items[0]?.name, startedAt });
    const ctx = { tabId, items, settings, results, startedAt };
    if (parallel > 1) await runParallel({ ...ctx, parallel });
    else await runSequential(ctx);

    const finalResults = results.filter(Boolean);
    const lastBatch = {
      results: finalResults,
      total: items.length,
      cancelled: batchCancelled,
      parallel: parallel > 1 ? parallel : undefined,
      startedAt,
      finishedAt: Date.now(),
    };
    await chrome.storage.session.set({ lastBatch }).catch(() => {});
    await recordRuns(finalResults.map((r) => ({
      ts: Date.now(),
      testId: r.testId,
      name: r.name,
      status: r.status || 'inconclusive',
      durationMs: r.durationMs,
      env: r.env,
    })));
    await saveBatchState({ status: 'done', total: items.length, done: finalResults.length, startedAt });
    chrome.runtime.sendMessage({ action: 'batchDone', lastBatch }).catch(() => {});
    return lastBatch;
  } finally {
    batchRunning = false;
    batchCancelled = false;
  }
}
