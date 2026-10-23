// apiKey/jiraToken/zephyrToken são segredos: ficam em chrome.storage.session (só em memória,
// somem ao fechar o Chrome) em vez de chrome.storage.local (persiste em disco). Tudo o mais
// continua em local. Estas funções espelham a assinatura de chrome.storage.local.get/set e
// roteiam cada chave para a área correta, para não exigir duas chamadas manuais em cada callsite.
const SESSION_KEYS = new Set(['apiKey', 'jiraToken', 'zephyrToken']);

export function storageGet(keys, callback) {
  const localKeys = keys.filter((k) => !SESSION_KEYS.has(k));
  const sessionKeys = keys.filter((k) => SESSION_KEYS.has(k));
  const promise = Promise.all([
    localKeys.length ? chrome.storage.local.get(localKeys) : Promise.resolve({}),
    sessionKeys.length ? chrome.storage.session.get(sessionKeys) : Promise.resolve({}),
  ]).then(([local, session]) => ({ ...local, ...session }));
  if (callback) { promise.then(callback); return; }
  return promise;
}

export function storageSet(data) {
  const localData = {};
  const sessionData = {};
  for (const [k, v] of Object.entries(data)) {
    (SESSION_KEYS.has(k) ? sessionData : localData)[k] = v;
  }
  const ops = [];
  if (Object.keys(localData).length) ops.push(chrome.storage.local.set(localData));
  if (Object.keys(sessionData).length) ops.push(chrome.storage.session.set(sessionData));
  return Promise.all(ops).then(() => {});
}

// Chamado uma vez na partida do service worker: quem já tinha apiKey/jiraToken/zephyrToken
// gravados em chrome.storage.local (de antes desta migração) tem o valor movido para
// chrome.storage.session e apagado do local — sem isso, a cópia antiga em disco ficaria
// para sempre, esvaziando o propósito da migração.
export async function migrateLegacySecretsFromLocal() {
  const keys = [...SESSION_KEYS];
  const [local, session] = await Promise.all([
    chrome.storage.local.get(keys),
    chrome.storage.session.get(keys),
  ]);
  const toSession = {};
  for (const k of keys) {
    if (local[k] !== undefined && session[k] === undefined) toSession[k] = local[k];
  }
  if (Object.keys(toSession).length) await chrome.storage.session.set(toSession);
  await chrome.storage.local.remove(keys);
}
