/* Leitura de cookies pela API chrome.cookies.
   Preferida ao CDP (Network.getCookies): traz os HttpOnly do mesmo jeito, sem anexar o
   depurador — logo sem o banner "está sendo depurado", sem conflitar com o DevTools do
   usuário aberto na aba e funcionando mesmo com o service worker frio. */

const SECRETISH_NAME = /token|auth|jwt|bearer|session|sid|secret|api[_-]?key|credential/i;

function maskCookieValue(name, value) {
  const v = String(value ?? '');
  if (!SECRETISH_NAME.test(name) && v.length <= 40) return v;
  return `${v.slice(0, 6)}…${v.length > 12 ? v.slice(-4) : ''} (${v.length} chars, mascarado)`;
}

function describeCookie(c) {
  const flags = [
    c.httpOnly ? 'HttpOnly' : '',
    c.secure ? 'Secure' : '',
    c.sameSite && c.sameSite !== 'unspecified' ? `SameSite=${c.sameSite}` : '',
    c.session ? 'sessão' : '',
  ].filter(Boolean).join(' · ');
  const expires = c.expirationDate
    ? new Date(c.expirationDate * 1000).toISOString()
    : 'ao fechar o navegador';
  return {
    name: c.name,
    domain: c.domain,
    path: c.path,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: c.sameSite,
    expires,
    chars: String(c.value ?? '').length,
    preview: maskCookieValue(c.name, c.value),
    flags,
  };
}

export async function listCookies(tabUrl, { urlFilter = '', includeSubdomains = true } = {}) {
  if (!chrome.cookies) throw new Error('A permissão "cookies" não está disponível nesta instalação da extensão.');
  const target = String(urlFilter || tabUrl || '');
  if (!/^https?:\/\//i.test(target)) {
    throw new Error(`Não dá para ler cookies desta página (${target || 'sem URL'}) — só http/https.`);
  }

  let cookies = await chrome.cookies.getAll({ url: target });
  if (includeSubdomains) {
    // getAll({url}) já respeita o escopo do domínio pai; a consulta por domain amplia
    // para irmãos (ex.: api.exemplo.com quando se está em app.exemplo.com).
    const host = new URL(target).hostname;
    const base = host.split('.').slice(-2).join('.');
    const byDomain = await chrome.cookies.getAll({ domain: base }).catch(() => []);
    const seen = new Set(cookies.map((c) => `${c.domain}|${c.path}|${c.name}`));
    for (const c of byDomain) {
      const key = `${c.domain}|${c.path}|${c.name}`;
      if (!seen.has(key)) { seen.add(key); cookies.push(c); }
    }
  }
  return cookies.map(describeCookie);
}

export async function readRawCookie(tabUrl, name) {
  if (!chrome.cookies) return null;
  const all = await chrome.cookies.getAll({ url: tabUrl }).catch(() => []);
  const hit = all.find((c) => c.name === name);
  return hit ? hit.value : null;
}

export function formatCookies(cookies) {
  if (!cookies.length) return 'Nenhum cookie neste domínio.';
  const httpOnly = cookies.filter((c) => c.httpOnly).length;
  const head = `${cookies.length} cookie(s) · ${httpOnly} HttpOnly (invisíveis para JavaScript da página)`;
  const body = cookies.slice(0, 60).map((c) =>
    `${c.name} = ${c.preview}\n    ${c.domain}${c.path} · ${c.flags || 'sem flags'} · expira: ${c.expires}`
  ).join('\n');
  return `${head}\n${body}`;
}
