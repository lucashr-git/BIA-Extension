// Trava de uso por login Google (OIDC), restrita ao domínio OIDC_ALLOWED_DOMAIN.
//
// Nota de segurança: validamos o id_token no cliente (assinatura NÃO verificada
// criptograficamente) porque o token chega direto do fluxo do próprio Google via
// chrome.identity.launchWebAuthFlow — um canal confiável controlado pelo navegador,
// não um valor arbitrário vindo de rede não confiável. A trava aqui é um controle de
// acesso de conveniência (impedir uso casual fora do domínio); a credencial real do
// produto continua sendo a API key do gateway, validada no servidor. Se algum dia
// isso precisar virar controle de segurança forte, valide a assinatura JWKS do Google
// num backend.

import { OIDC_CLIENT_ID, OIDC_ALLOWED_DOMAIN } from '../shared/constants.js';

const AUTH_STORAGE_KEY = 'authSession';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const ALLOWED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export function isAuthRequired() {
  return !!String(OIDC_CLIENT_ID || '').trim();
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlDecode(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// Decodifica o payload de um id_token JWT (header.payload.signature) sem validar a
// assinatura — ver nota de segurança no topo do arquivo.
export function decodeIdTokenPayload(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('id_token malformado');
  return JSON.parse(base64UrlDecode(parts[1]));
}

// Validação pura (sem chrome.*) do payload de um id_token do Google — testável isoladamente.
// Retorna { valid: true, email, name, exp } ou { valid: false, reason }.
export function validateIdToken(payload, { clientId = OIDC_CLIENT_ID, allowedDomain = OIDC_ALLOWED_DOMAIN, nonce = null, now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object') return { valid: false, reason: 'invalid' };
  if (!ALLOWED_ISSUERS.includes(payload.iss)) return { valid: false, reason: 'invalid' };
  if (payload.aud !== clientId) return { valid: false, reason: 'invalid' };
  if (!payload.exp || payload.exp * 1000 <= now) return { valid: false, reason: 'invalid' };
  if (nonce !== null && payload.nonce !== nonce) return { valid: false, reason: 'invalid' };
  if (payload.email_verified !== true) return { valid: false, reason: 'invalid' };
  const email = String(payload.email || '');
  const domainMatches = payload.hd === allowedDomain || email.toLowerCase().endsWith('@' + allowedDomain.toLowerCase());
  if (!domainMatches) return { valid: false, reason: 'domain_not_allowed' };
  return { valid: true, email, name: payload.name || email, exp: payload.exp * 1000 };
}

export async function getAuthState() {
  const stored = await chrome.storage.local.get([AUTH_STORAGE_KEY]).catch(() => ({}));
  const session = stored[AUTH_STORAGE_KEY];
  if (!session || !session.exp || session.exp <= Date.now()) return null;
  return session;
}

function extractIdTokenFromRedirect(redirectUrl) {
  const url = new URL(redirectUrl);
  const fragment = new URLSearchParams(url.hash ? url.hash.slice(1) : '');
  const query = new URLSearchParams(url.search || '');
  return fragment.get('id_token') || query.get('id_token') || '';
}

export async function signIn() {
  if (!isAuthRequired()) throw new Error('Login não é necessário nesta build (OIDC_CLIENT_ID vazio).');

  const redirectUri = chrome.identity.getRedirectURL();
  const nonce = randomNonce();

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', OIDC_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('prompt', 'select_account');

  let redirectUrl;
  try {
    redirectUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, (result) => {
        if (chrome.runtime.lastError || !result) {
          reject(new Error(chrome.runtime.lastError?.message || 'Login cancelado'));
          return;
        }
        resolve(result);
      });
    });
  } catch (e) {
    return { success: false, error: 'generic', message: e.message };
  }

  const idToken = extractIdTokenFromRedirect(redirectUrl);
  if (!idToken) return { success: false, error: 'generic', message: 'Google não retornou o token de login.' };

  let payload;
  try {
    payload = decodeIdTokenPayload(idToken);
  } catch (e) {
    return { success: false, error: 'generic', message: 'Token de login inválido.' };
  }

  const result = validateIdToken(payload, { nonce });
  if (!result.valid) {
    return {
      success: false,
      error: result.reason,
      message: result.reason === 'domain_not_allowed'
        ? `Esta conta não pertence ao domínio autorizado (@${OIDC_ALLOWED_DOMAIN}).`
        : 'Não foi possível entrar. Tente novamente.',
    };
  }

  const session = { email: result.email, name: result.name, exp: result.exp };
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: session }).catch(() => {});
  return { success: true, session };
}

export async function signOut() {
  await chrome.storage.local.remove([AUTH_STORAGE_KEY]).catch(() => {});
  return { success: true };
}
