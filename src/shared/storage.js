import { SESSION_ONLY_CONFIG_KEYS } from './constants.js';

const SESSION_ONLY_KEY_SET = new Set(SESSION_ONLY_CONFIG_KEYS);

function splitKeys(keys) {
  const sessionKeys = [];
  const localKeys = [];
  for (const key of keys) {
    if (SESSION_ONLY_KEY_SET.has(key)) sessionKeys.push(key);
    else localKeys.push(key);
  }
  return { sessionKeys, localKeys };
}

export async function getStoredConfig(keys) {
  const { sessionKeys, localKeys } = splitKeys(keys);
  const [localValues, sessionValues] = await Promise.all([
    localKeys.length ? chrome.storage.local.get(localKeys) : Promise.resolve({}),
    sessionKeys.length ? chrome.storage.session.get(sessionKeys) : Promise.resolve({}),
  ]);
  return { ...localValues, ...sessionValues };
}

export async function setStoredConfig(values) {
  const sessionValues = {};
  const localValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (SESSION_ONLY_KEY_SET.has(key)) sessionValues[key] = value;
    else localValues[key] = value;
  }
  await Promise.all([
    Object.keys(localValues).length ? chrome.storage.local.set(localValues) : Promise.resolve(),
    Object.keys(sessionValues).length ? chrome.storage.session.set(sessionValues) : Promise.resolve(),
  ]);
}

export async function removeSessionOnlyConfigFromLocal() {
  await chrome.storage.local.remove(SESSION_ONLY_CONFIG_KEYS);
}

export async function migrateSessionOnlyConfig() {
  const [legacy, current] = await Promise.all([
    chrome.storage.local.get(SESSION_ONLY_CONFIG_KEYS),
    chrome.storage.session.get(SESSION_ONLY_CONFIG_KEYS),
  ]);
  const toSession = {};
  for (const key of SESSION_ONLY_CONFIG_KEYS) {
    if (!current[key] && legacy[key]) toSession[key] = legacy[key];
  }
  await Promise.all([
    Object.keys(toSession).length ? chrome.storage.session.set(toSession) : Promise.resolve(),
    chrome.storage.local.remove(SESSION_ONLY_CONFIG_KEYS),
  ]);
}
