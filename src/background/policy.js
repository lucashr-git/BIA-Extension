const SENSITIVE_TERMS = [
  'captcha',
  'mfa', '2fa', 'two-factor', 'autenticação de dois fatores',
  'paywall',
  'delete account', 'excluir conta', 'deletar conta', 'remover conta', 'apagar conta',
  'payment', 'pagamento', 'pagar agora', 'finalizar compra', 'confirmar compra', 'purchase',
  'cartão de crédito', 'credit card', 'cvv',
  'publicar', 'publish',
  'alterar senha', 'trocar senha', 'change password', 'reset password', 'redefinir senha',
  'enviar mensagem', 'send message',
  'transferir', 'transferência', 'wire transfer', 'pix',
  'sair da conta', 'logout', 'sign out', 'deslogar', 'encerrar sessão',
  'desativar', 'revogar', 'cancelar assinatura', 'unsubscribe',
  'excluir', 'deletar', 'apagar', 'remover', 'eliminar', 'destruir', 'zerar',
  'delete', 'remove', 'erase', 'wipe', 'drop database',
  'apagar tudo', 'excluir permanentemente', 'encerrar conta', 'clear data', 'limpar dados',
];

const INJECTION_PATTERNS = [
  /ignore (all |as |the )?(previous|above|prior) (instructions|rules)/i,
  /ignore (todas as |as )?instruções (anteriores|acima)/i,
  /disregard (your|all) (instructions|rules|system prompt)/i,
  /you are now (a|an) /i,
  /novo system prompt/i,
  /reveal (your )?(system prompt|instructions)/i,
  // Tentativas de fazer a Bia vazar credenciais a partir de texto lido da página
  /(reveal|mostre|mostrar|exiba|exibir|imprima|envie|enviar|show|print|send)\s+[\wà-ú\s]{0,20}(token|jwt|cookie|authorization|api[_-]?key|refresh|credencia|senha|password)/i,
  /(chame|use|call)\s+reveal_secret/i,
];

const REQUIRED_FIELDS = {
  navigate: ['url'],
  click: ['target|selector'],
  type: ['target|selector', 'text|value'],
  fill: ['target|selector', 'text|value'],
  clear: ['target|selector'],
  select: ['target|selector', 'value|optionText'],
  select_dropdown_option: ['target|selector', 'optionText|value'],
  get_dropdown_options: ['target|selector'],
  check_checkbox: ['target|selector'],
  press_enter: [],
  hover: ['target|selector'],
  scroll_to: ['target|selector'],
  scroll_to_text: ['text'],
  find: ['text|query'],
  send_keys: ['keys|key'],
  key: ['key'],
  extract_text: ['selector|target'],
  get_attribute: ['selector|target', 'attribute'],
  get_css: ['selector|target'],
  assert_text: ['text'],
  assert_url_includes: ['part'],
  assert_network_request: ['urlIncludes'],
  wait_for_selector: ['selector'],
  wait_for_text: ['text'],
  search: ['text'],
};

function hasField(act, spec) {
  return spec.split('|').some((name) => {
    const value = act[name];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
  });
}

function collectActionText(act) {
  const parts = [
    act.selector, act.text, act.value, act.optionText, act.url, act.part,
    // Campos das ferramentas de inspeção: sem isso, um pedido de segredo
    // escaparia da checagem de prompt injection.
    act.reason, act.key, act.filter, act.area, act.source, act.urlIncludes, act.urlFilter,
  ];
  if (act.target && typeof act.target === 'object') {
    parts.push(act.target.text, act.target.label, act.target.selectorHint);
  }
  return parts.filter((p) => typeof p === 'string').join(' ').toLowerCase();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SENSITIVE_MATCHERS = SENSITIVE_TERMS.map((term) => ({
  term,
  regex: term.includes(' ')
    ? new RegExp(escapeRegex(term), 'i')
    : new RegExp(`(^|[^a-z0-9à-ú])${escapeRegex(term)}([^a-z0-9à-ú]|$)`, 'i'),
}));

function findSensitiveTerm(text) {
  const match = SENSITIVE_MATCHERS.find(({ regex }) => regex.test(text));
  return match ? match.term : null;
}

const NEGATION_NEARBY = /\b(n[ãa]o|nunca|jamais|sem|evite|evitar|don'?t|do not|never|without)\b/;

function hasUnnegatedMention(promptLower, term) {
  let idx = promptLower.indexOf(term);
  while (idx !== -1) {
    const windowBefore = promptLower.slice(Math.max(0, idx - 40), idx);
    const clause = windowBefore.split(/[.,;:!?\n]/).pop();
    if (!NEGATION_NEARBY.test(clause)) return true;
    idx = promptLower.indexOf(term, idx + term.length);
  }
  return false;
}

export const READ_ONLY_ACTIONS = new Set([
  'extract_text', 'get_attribute', 'get_css', 'get_links', 'get_errors',
  'get_network_requests', 'assert_network_request', 'wait_for_network_idle', 'accessibility_audit',
  'assert_text', 'assert_url_includes', 'wait', 'wait_for_selector', 'wait_for_text',
  'screenshot', 'scroll', 'scroll_to', 'scroll_to_text', 'find', 'get_dropdown_options',
  // Inspeção nível DevTools — só leem, nunca alteram a página
  'get_storage', 'get_page_diagnostics', 'get_cookies', 'get_network_request_detail',
]);

export function evaluateAction(act, scanState, userPrompt = '') {
  if (!act || !act.type) {
    return { verdict: 'block', reason: 'Ação sem campo "type"' };
  }

  const required = REQUIRED_FIELDS[act.type];
  if (required) {
    for (const spec of required) {
      if (!hasField(act, spec)) {
        return { verdict: 'block', reason: `Ação ${act.type} sem campo obrigatório: ${spec}` };
      }
    }
  }

  if (act.type === 'navigate') {
    const url = String(act.url || '').trim().toLowerCase();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { verdict: 'block', reason: `Navegação bloqueada: URL não é HTTP/HTTPS (${act.url})` };
    }
  }

  const actionText = collectActionText(act);
  if (INJECTION_PATTERNS.some((p) => p.test(actionText))) {
    return { verdict: 'block', reason: 'Possível prompt injection detectada no conteúdo da ação' };
  }
  if (!READ_ONLY_ACTIONS.has(act.type)) {
    let textsToCheck = actionText;

    if (act.target && typeof act.target.index === 'number' && scanState?.elements) {
      const el = scanState.elements.find((e) => e.index === act.target.index);
      if (el) {
        textsToCheck += ' ' + [el.text, el.label, el.contextText].filter(Boolean).join(' ').toLowerCase();
      }
    }

    const term = findSensitiveTerm(textsToCheck);
    if (term) {
      const promptLower = (userPrompt || '').toLowerCase();
      if (hasUnnegatedMention(promptLower, term)) {
        return { verdict: 'allow', reason: `Termo sensível "${term}" autorizado pelo objetivo do teste` };
      }
      return {
        verdict: 'confirm',
        reason: `Ação envolve termo sensível: "${term}". Confirme para prosseguir.`,
      };
    }
  }

  return { verdict: 'allow', reason: '' };
}

/* Gate de intenção do reveal_secret.
   O `userPrompt` é a mensagem que o USUÁRIO digitou no chat — conteúdo da página nunca
   entra aqui. Exigir que o pedido apareça nele é o que impede uma página maliciosa de
   induzir a Bia a revelar um token: ela não consegue alterar o que o usuário escreveu. */
const SECRET_REQUEST_TERMS = [
  'token', 'jwt', 'bearer', 'cookie', 'cookies', 'authorization', 'refresh token', 'access token',
  'id token', 'api key', 'api-key', 'apikey', 'chave de api', 'credencial', 'credenciais',
  'segredo', 'secret', 'session id', 'sessionid', 'valor cru', 'valor completo', 'valor real',
  'sem mascarar', 'sem máscara', 'desmascar', 'não mascarado', 'nao mascarado',
];

export function userAskedForSecrets(userPrompt = '') {
  const lower = String(userPrompt).toLowerCase();
  return SECRET_REQUEST_TERMS.some((term) => lower.includes(term) && hasUnnegatedMention(lower, term));
}

function luhnValid(digits) {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alternate) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function redactSecrets(text) {
  if (!text) return text;
  return String(text)
    .replace(/(authorization|cookie|token|password|senha|api[_-]?key|secret)(["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi, '$1$2***')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***.***.***-**')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '**.***.***/****-**')
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 16 && luhnValid(digits) ? m.replace(/\d/g, '*') : m;
    })
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/gi, '***@***')
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, 'eyJ***JWT-REDACTED***');
}
