// Client ID OAuth do Google (tipo Web application, redirect
// https://<EXTENSION_ID>.chromiumapp.org/). VAZIO = trava de login DESLIGADA (modo
// dev/open-source). Preencha antes de empacotar para a Web Store.
export const OIDC_CLIENT_ID = '1028636434924-ai38ekc9to5qi9iom64sabt3o75513gk.apps.googleusercontent.com';
export const OIDC_ALLOWED_DOMAIN = 'ciandt.com';

// Modelo dos testes da aba Executar (o chat tem o seletor próprio no composer).
// Não há mais campo de texto nas Configurações: um valor antigo em storage.model
// continua sendo respeitado, e quem não tiver nenhum cai aqui.
export const DEFAULT_MODEL = 'claude-sonnet-5';
// Modelo rápido para micro-ações no modo Auto (roteamento adaptativo Sonnet planeja / Haiku executa).
export const HAIKU_MODEL = 'claude-haiku-4-5';
export const DEFAULT_MAX_STEPS = 25;

// Modos do chat. O rótulo é o que o usuário vê; `loopMode` é o que agentLoop entende.
// Atenção: no agentLoop, 'chat' sempre significou "conversa com todas as ferramentas" —
// que é justamente o modo Agente. Por isso o modo Chat da UI mapeia para 'ask'.
export const CHAT_MODES = [
  { id: 'agent', label: 'Agente', loopMode: 'chat', hint: 'Executa ações na página' },
  { id: 'chat', label: 'Chat', loopMode: 'ask', hint: 'Só lê e responde — não mexe na página' },
  { id: 'translate', label: 'Tradutor', loopMode: null, hint: 'Traduz PT ↔ EN automaticamente' },
];

export const DEFAULT_CHAT_MODE = 'agent';

export function normalizeChatMode(value) {
  return CHAT_MODES.some((m) => m.id === value) ? value : DEFAULT_CHAT_MODE;
}

export function chatModeConfig(value) {
  return CHAT_MODES.find((m) => m.id === normalizeChatMode(value));
}

/* Modelos oferecidos no seletor do chat. `transport` define qual API do gateway é usada:
   'anthropic' → POST /v1/messages · 'openai' → POST /v1/chat/completions.

   Todos abaixo foram testados contra um gateway LiteLLM: respondem e,
   os não-Anthropic, devolvem tool_calls corretamente pela rota OpenAI.

   Ficaram de fora, por medição e não por preferência:
   • gpt-5.5   → 404 "Path 'chat/completions' is not allowed" (parece config errada no
                 LiteLLM: o modelo aparece em /v1/models mas nenhuma rota o alcança);
   • gpt-4o e anthropic.claude-4-8-opus → 403, exigem liberação;
   • deepseek-r1 → a documentação do Flow avisa que não suporta ferramentas.
   Aparecer em GET /v1/models não garante que funcione — use "↻ Atualizar do proxy" para
   descobrir IDs novos, mas confirme com uma mensagem antes de confiar. */
export const CHAT_MODELS = [
  // Anthropic — rota nativa /v1/messages, onde as 43 ferramentas do agente já são testadas
  { id: 'claude-haiku-4-5', group: 'Anthropic', label: 'Haiku 4.5', hint: 'Econômico — dia a dia (2,7s)', transport: 'anthropic' },
  { id: 'claude-opus-5', group: 'Anthropic', label: 'Opus 5', hint: 'Top — raciocínio longo context alto (3,2s)', transport: 'anthropic' },
  { id: 'claude-sonnet-5', group: 'Anthropic', label: 'Sonnet 5', hint: 'Top — raciocínio longo (3,2s)', transport: 'anthropic' },

  // OpenAI. ⚠️ Duas armadilhas medidas neste modelo:
  //  1. o ID do 5.5 usa HÍFEN — "gpt-5.5" devolve 404, "gpt-5-5" funciona;
  //  2. ele RECUSA `temperature` ("Only the default (1) value is supported"), tratado
  //     pelo retry sem temperature em callClaude.
  { id: 'gpt-4o-mini', group: 'OpenAI', label: 'GPT-4o mini', hint: 'Econômico — o mais rápido de todos (2,5s)', transport: 'openai' },
  { id: 'gpt-5.1', group: 'OpenAI', label: 'GPT 5.1', hint: 'Intermediário (3,4s)', transport: 'openai' },
  { id: 'gpt-5-5', group: 'OpenAI', label: 'GPT 5.5', hint: 'Top — o mais novo da OpenAI (4,1s)', transport: 'openai' },

  // Google — mais lentos no uso real do que numa frase curta: eles raciocinam antes
  // de responder, e isso aparece quando o texto cresce.
  { id: 'gemini-2.5-flash', group: 'Google', label: 'Gemini 2.5 Flash', hint: 'Econômico (4,2s)', transport: 'openai' },
  { id: 'gemini-2.5-pro', group: 'Google', label: 'Gemini 2.5 Pro', hint: 'Intermediário (4,2s)', transport: 'openai' },
  { id: 'gemini-3.1-pro', group: 'Google', label: 'Gemini 3.1 Pro', hint: 'Top — o mais novo do Google (4,6s)', transport: 'openai' },
];

/* Os 9 acima foram chamados contra o proxy Flow em 2026-08-07: responderam 200 e
   devolveram tool_calls corretamente. Os tempos são a MEDIANA de 5 traduções reais
   (parágrafo, não "diga oi"), com os mesmos parâmetros que o modo Tradutor envia.
   As faixas se sobrepõem bastante — trate como ordem de grandeza, não como ranking.

   Também testados e funcionando, fora da lista de propósito para o seletor ficar enxuto.
   Alcance por "↻ Atualizar do proxy" ou "Outro…" — o transporte já está pronto:
     OpenAI  gpt-4.1 · gpt-5 · gpt-5-1 · gpt-5-2 · gpt-5-4 · gpt-5-4-mini · gpt-5-mini
             gpt-5-nano · gpt-5-codex · gpt-5.1-codex · o3-mini
     Google  gemini-2.0-flash · gemini-3.1-pro-preview · gemini-3.1-pro[1m] (contexto de 1M)
     Outros  deepseek-v4-pro · mistral-small-2503

   Não funcionam neste proxy (medido, não suposto):
     gpt-5.2 / gpt-5.4 / gpt-5.5 → 404 (use a forma com hífen)
     gpt-4o e anthropic.claude-4-8-opus → 403, exigem liberação
     deepseek-r1 → 400, e a doc do Flow avisa que não suporta ferramentas
     grok-3 → 503 · claude-fable-5 → 400 no Bedrock
     o1 → cai numa rota-curinga quebrada do proxy

   ⚠️ Sobre essa rota-curinga: nomes SEM prefixo de fornecedor (o1, sol, luna, e até
   "banana-9000") devolvem 500 "OpenAIProvider.__init__() missing 1 required positional
   argument" em vez de 400. É um curinga que aceita qualquer coisa e quebra — não confunda
   com "o modelo existe mas está com problema". Nomes com prefixo (gpt-*, gemini-*,
   claude-*) devolvem 400 honesto quando não existem. */

// Modelos não-Anthropic entram pela API compatível com OpenAI do proxy.
export function modelTransport(model) {
  const id = String(model || '');
  const known = CHAT_MODELS.find((m) => m.id === id);
  if (known) return known.transport;
  return /^(anthropic\.|claude-)/i.test(id) ? 'anthropic' : 'openai';
}

export function chatModelLabel(model) {
  const known = CHAT_MODELS.find((m) => m.id === model);
  if (known) return known.label;
  const id = String(model || '');
  return id.length > 22 ? `${id.slice(0, 21)}…` : (id || 'Padrão');
}
export const MIN_MAX_STEPS = 5;
export const MAX_MAX_STEPS = 60;
export const MAX_SCROLLS = 10;

export function clampMaxSteps(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_STEPS;
  return Math.min(MAX_MAX_STEPS, Math.max(MIN_MAX_STEPS, n));
}

export function isRestrictedUrl(url) {
  return !url || url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('chrome-extension://');
}

export function sanitizePathSegment(value) {
  return String(value || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/^-+|-+$/g, '');
}

export function looksLikeUrl(value) {
  if (!value) return true;
  try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch (_) { return false; }
}
