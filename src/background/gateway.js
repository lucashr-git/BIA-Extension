import { DEFAULT_MODEL, modelTransport } from '../shared/constants.js';

// Gateway padrão quando o usuário não configura um: API direta da Anthropic.
// Qualquer gateway compatível (ex.: LiteLLM) pode ser definido nas Configurações.
const DEFAULT_GATEWAY_URL = 'https://api.anthropic.com';

function combineSignals(external, timeoutMs) {
  if (typeof AbortSignal.any === 'function') {
    const timeout = AbortSignal.timeout(timeoutMs);
    return { signal: external ? AbortSignal.any([external, timeout]) : timeout, dispose() {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`Timeout de ${timeoutMs}ms`, 'TimeoutError')),
    timeoutMs
  );
  const dispose = () => clearTimeout(timer);
  if (external) {
    if (external.aborted) { dispose(); controller.abort(external.reason); }
    else external.addEventListener('abort', () => { dispose(); controller.abort(external.reason); }, { once: true });
  }
  return { signal: controller.signal, dispose };
}

function buildAuthHeaders(gatewayUrl, apiKey) {
  if (gatewayUrl && gatewayUrl.includes('api.anthropic.com')) {
    return { 'x-api-key': apiKey };
  }
  return { 'Authorization': `Bearer ${apiKey}` };
}

function resolveModelName(gatewayUrl, model) {
  const name = model || DEFAULT_MODEL;
  if (!gatewayUrl.includes('api.anthropic.com')) return name;
  const m = name.match(/^anthropic\.claude-(\d+)-(\d+)-([a-z]+)$/i);
  return m ? `claude-${m[3]}-${m[1]}-${m[2]}` : name;
}

export const EFFORT_HIGH = 'high';
export const EFFORT_MEDIUM = 'medium';
export const EFFORT_LOW = 'low';

// Claude 5+ (e Opus 4.7/4.8) removeram `temperature` — enviá-lo retorna 400 — e
// usam `effort` no lugar; o 4.6 e anteriores ainda aceitam `temperature`.
// Modelo em formato desconhecido: não envia nenhum dos dois (seguro em qualquer modelo).
//
// O esforço é por chamada e importa MUITO: medido no proxy Flow com o Sonnet 5 traduzindo
// uma frase — effort:high levou mais de 120s, sem effort 3,0s e effort:low 2,2s, com
// resposta idêntica. Alto só se paga onde há raciocínio de verdade (o agente de QA).
function samplingParams(model, effort = EFFORT_HIGH) {
  const m = (model || DEFAULT_MODEL).match(/claude-(\d+)(?:-(\d+))?/i);
  if (!m) return {};
  const major = Number(m[1]);
  const minor = Number(m[2] || 0);
  const rejectsTemperature = major >= 5 || (major === 4 && minor >= 7);
  return rejectsTemperature ? { output_config: { effort } } : { temperature: 0 };
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS_MS = [1000, 3000];

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/* ===== Conversão Anthropic → OpenAI =====
   Os modelos não-Anthropic do proxy Flow entram pela API compatível com OpenAI
   (POST /v1/chat/completions), com o mesmo Bearer. Todo o agente fala em blocos
   Anthropic, então a tradução acontece só aqui — na ida e na volta. */

function imagePart(block) {
  const src = block.source || {};
  return { type: 'image_url', image_url: { url: `data:${src.media_type || 'image/jpeg'};base64,${src.data}` } };
}

function openAIToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
  }
  return String(content ?? '');
}

// O bloco `system` chega como string OU como array de blocos Anthropic (com cache_control,
// usado no transport anthropic para prompt caching). LiteLLM na ponte OpenAI não lida bem
// com cache_control, então aqui ele só concatena o texto — sem repassar o campo.
function systemToPlainText(system) {
  if (Array.isArray(system)) return system.map((b) => (b && typeof b === 'object' ? b.text || '' : String(b))).join('\n');
  return system || '';
}

function toOpenAIMessages(messages, system) {
  const out = [];
  const systemText = systemToPlainText(system);
  if (systemText) out.push({ role: 'system', content: systemText });

  for (const msg of messages) {
    const blocks = typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : (Array.isArray(msg.content) ? msg.content : []);

    if (msg.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // Um turno de usuário no formato Anthropic mistura tool_results, texto e imagens.
    // No OpenAI cada tool_result vira sua própria mensagem role:'tool', e ela precisa
    // vir logo depois do assistant que pediu a ferramenta — por isso os results vêm antes.
    for (const b of blocks.filter((b) => b.type === 'tool_result')) {
      out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: openAIToolResultContent(b.content) });
    }

    const rest = blocks.filter((b) => b.type === 'text' || b.type === 'image');
    if (!rest.length) continue;
    const hasImage = rest.some((b) => b.type === 'image');
    out.push({
      role: 'user',
      content: hasImage
        ? rest.map((b) => (b.type === 'image' ? imagePart(b) : { type: 'text', text: b.text }))
        : rest.map((b) => b.text).join('\n'),
    });
  }
  return out;
}

function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

const OPENAI_FINISH_REASON = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  length: 'max_tokens',
  content_filter: 'stop_sequence',
};

function parseOpenAIResponse(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  let text = String(message.content || '').trim();
  const toolUses = (message.tool_calls || [])
    .filter((c) => c && c.function)
    .map((c) => {
      let input = {};
      try {
        input = JSON.parse(c.function.arguments || '{}');
      } catch (_) {
        // Modelo devolveu JSON inválido: a validação de campos obrigatórios em
        // policy.js rejeita a ação e o modelo recebe o motivo para tentar de novo.
        input = {};
      }
      return { type: 'tool_use', id: c.id, name: c.function.name, input };
    });

  // GPT-5, Gemini 3.1 e DeepSeek raciocinam antes de escrever, e esses reasoning_tokens
  // saem do MESMO orçamento de max_tokens. Se o orçamento acabar no meio do raciocínio,
  // a resposta volta 200 com content vazio — o que pareceria "o modelo não respondeu".
  const reasoning = data?.usage?.completion_tokens_details?.reasoning_tokens || 0;
  if (!text && !toolUses.length && reasoning > 0) {
    text = `[O modelo gastou os ${reasoning} tokens disponíveis raciocinando e não sobrou orçamento para a resposta. Aumente max_tokens ou use um modelo Anthropic.]`;
  }

  const content = [
    ...(text ? [{ type: 'text', text }] : []),
    ...toolUses,
  ];
  return {
    text,
    toolUses,
    stopReason: OPENAI_FINISH_REASON[choice.finish_reason] || choice.finish_reason || '',
    // Mantido em blocos Anthropic: é o que o agentLoop reenvia no próximo turno.
    rawContent: content,
    usage: data?.usage || null,
  };
}

/* ===== Prompt caching (Anthropic cache_control) =====
   Só o transport anthropic (/v1/messages) suporta cache_control — a ponte OpenAI do
   LiteLLM tem bugs conhecidos com ele, então nunca é enviado nesse transport.
   Estratégia: 2 breakpoints por request —
     1) o 1º (e único) bloco do `system` estático, marcado pelo próprio agent.js;
     2) o último bloco de conteúdo da ÚLTIMA mensagem de `messages` — breakpoint móvel que
        faz o histórico do loop (que só cresce) cachear incrementalmente a cada turno.
   `messages` é reconstruído pelo agentLoop a cada turno, mas REAPROVEITA os objetos de
   mensagens antigas — por isso as funções abaixo NUNCA mutam o array/objetos recebidos:
   sempre clonam antes de marcar, senão a marcação do turno anterior "vazaria" para dentro
   do array reutilizado e se acumularia. */

function stripBlockCacheControl(block) {
  if (!block || typeof block !== 'object') return block;
  const { cache_control, ...rest } = block;
  return rest;
}

function stripMessageCacheControl(message) {
  if (!Array.isArray(message.content)) return message;
  return { ...message, content: message.content.map(stripBlockCacheControl) };
}

function stripSystemCacheControl(system) {
  return Array.isArray(system) ? system.map(stripBlockCacheControl) : system;
}

// Clona `messages` (sem mutar nada do array/objetos originais) e marca cache_control
// ephemeral só no último bloco de conteúdo da última mensagem.
function markLastMessageCacheable(messages) {
  if (!messages.length) return messages;
  const cleaned = messages.map(stripMessageCacheControl);
  const lastIdx = cleaned.length - 1;
  const last = cleaned[lastIdx];
  const blocks = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }]
    : (Array.isArray(last.content) ? last.content.slice() : []);
  if (blocks.length) {
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
    cleaned[lastIdx] = { ...last, content: blocks };
  }
  return cleaned;
}

function buildRequest({ transport, baseUrl, messages, system, tools, toolChoice, model, maxTokens, apiKey, effort, dropTemperature = false, enableCache = false, enableStream = false }) {
  if (transport === 'openai') {
    const payload = {
      model,
      max_tokens: maxTokens,
      // Alguns modelos (medido: gpt-5-5) devolvem 400 se `temperature` vier junto. Como
      // não há regra estável para saber quais, mandamos e removemos na primeira recusa —
      // ver o retry em callClaude. Assim modelos futuros se resolvem sozinhos.
      ...(dropTemperature ? {} : { temperature: 0 }),
      messages: toOpenAIMessages(messages, system),
      ...(tools && tools.length ? { tools: toOpenAITools(tools), tool_choice: 'auto' } : {}),
    };
    return {
      url: `${baseUrl}/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(baseUrl, apiKey) },
      body: JSON.stringify(payload),
      parse: parseOpenAIResponse,
    };
  }
  const anthropicSystem = enableCache ? system : stripSystemCacheControl(system);
  const anthropicMessages = enableCache ? markLastMessageCacheable(messages) : messages.map(stripMessageCacheControl);
  return {
    url: `${baseUrl}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...buildAuthHeaders(baseUrl, apiKey),
    },
    body: JSON.stringify({
      model: resolveModelName(baseUrl, model),
      max_tokens: maxTokens,
      ...samplingParams(model, effort),
      system: anthropicSystem,
      messages: anthropicMessages,
      ...(tools && tools.length ? { tools, tool_choice: toolChoice || { type: 'auto' } } : {}),
      ...(enableStream ? { stream: true } : {}),
    }),
    parse: (data) => {
      const content = Array.isArray(data.content) ? data.content : [];
      return {
        text: content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim(),
        toolUses: content.filter((c) => c && c.type === 'tool_use'),
        stopReason: data.stop_reason || '',
        rawContent: content,
        usage: data.usage || null,
      };
    },
  };
}

/* ===== Streaming (Anthropic Messages API, SSE) =====
   Só o transport anthropic suporta `stream:true`. O parser reconstrói exatamente o mesmo
   formato que `parse()` devolve no caminho não-streaming (text/toolUses/stopReason/
   rawContent/usage) — o agentLoop não precisa saber se a resposta veio em stream ou não.
   `createSSEAccumulator` é a lógica comum entre o parser "offline" (usado nos testes, com
   uma transcrição SSE completa) e o consumo incremental do ReadableStream do fetch real. */

function createSSEAccumulator(onDelta) {
  const blocks = [];
  let stopReason = '';
  let usage = null;

  function feedEvent(eventText) {
    const lines = String(eventText).split('\n');
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }
    if (!dataStr) return;
    let data;
    try {
      data = JSON.parse(dataStr);
    } catch (_) {
      return;
    }
    switch (data.type) {
      case 'message_start':
        if (data.message?.usage) usage = data.message.usage;
        break;
      case 'content_block_start': {
        const idx = data.index;
        const cb = data.content_block || {};
        blocks[idx] = cb.type === 'tool_use'
          ? { type: 'tool_use', id: cb.id, name: cb.name, inputBuffer: '' }
          : { type: 'text', text: cb.text || '' };
        break;
      }
      case 'content_block_delta': {
        const block = blocks[data.index];
        if (!block) break;
        if (data.delta?.type === 'text_delta') {
          block.text = (block.text || '') + (data.delta.text || '');
          if (onDelta) { try { onDelta(data.delta.text || ''); } catch (_) {} }
        } else if (data.delta?.type === 'input_json_delta') {
          block.inputBuffer = (block.inputBuffer || '') + (data.delta.partial_json || '');
        }
        break;
      }
      case 'message_delta':
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        if (data.usage) usage = { ...(usage || {}), ...data.usage };
        break;
      // content_block_stop, message_stop, ping: nada a fazer além do que já foi acumulado.
      default:
        break;
    }
  }

  function result() {
    const rawContent = blocks.filter(Boolean).map((b) => {
      if (b.type === 'tool_use') {
        let input = {};
        try { input = b.inputBuffer ? JSON.parse(b.inputBuffer) : {}; } catch (_) { input = {}; }
        return { type: 'tool_use', id: b.id, name: b.name, input };
      }
      return { type: 'text', text: b.text || '' };
    });
    return {
      text: rawContent.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim(),
      toolUses: rawContent.filter((c) => c.type === 'tool_use'),
      stopReason,
      rawContent,
      usage,
    };
  }

  return { feedEvent, result };
}

// Usado pelos testes: recebe a transcrição SSE inteira (string) já concatenada e devolve
// o resultado final, disparando onDelta na ordem em que os eventos text_delta apareceriam.
export function parseAnthropicSSE(sseText, onDelta) {
  const acc = createSSEAccumulator(onDelta);
  const events = String(sseText).split(/\n\n+/).map((e) => e.trim()).filter(Boolean);
  for (const evt of events) acc.feedEvent(evt);
  return acc.result();
}

// Consome o ReadableStream do fetch real linha a linha, repassando cada text_delta pro
// onDelta assim que chega (streaming de verdade) e devolvendo o mesmo formato de sempre.
async function streamAnthropicResponse(res, onDelta) {
  const acc = createSSEAccumulator(onDelta);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const evt = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (evt.trim()) acc.feedEvent(evt);
    }
  }
  if (buffer.trim()) acc.feedEvent(buffer);
  return acc.result();
}

/* Lista os modelos que o token realmente libera no proxy Flow.
   Evita depender de IDs adivinhados: o nome comercial ("GPT 5.5") quase nunca é igual ao
   ID técnico, e um ID errado só aparece na cara do usuário como erro no meio da conversa. */
export async function listGatewayModels({ apiKey, gatewayUrl, timeoutMs = 15000 }) {
  const baseUrl = (gatewayUrl || DEFAULT_GATEWAY_URL).replace(/\/$/, '');
  const combined = combineSignals(null, timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(baseUrl, apiKey) },
      signal: combined.signal,
      credentials: 'omit',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `O gateway respondeu ${res.status} ao listar modelos.`);
    }
    const data = await res.json();
    const ids = (Array.isArray(data?.data) ? data.data : [])
      .map((m) => (typeof m === 'string' ? m : m?.id))
      .filter((id) => typeof id === 'string' && id);
    if (!ids.length) throw new Error('O gateway não retornou nenhum modelo.');
    return [...new Set(ids)].sort();
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('Tempo limite ao listar os modelos do gateway.');
    throw e;
  } finally {
    combined.dispose();
  }
}

// Fica ligado por padrão; se o gateway devolver 400 mencionando cache_control (proxy sem
// suporte), callClaude desliga este flag para o resto da sessão do service worker, e nenhuma
// chamada seguinte tenta cache_control de novo.
let cacheControlUnsupported = false;

// Fica ligado por padrão quando há onDelta; se o gateway devolver 400 mencionando `stream`,
// ou a resposta 200 não vier em text/event-stream (proxy que ignora o parâmetro), ou o
// parse da SSE falhar, desliga para o resto da sessão do service worker — mesmo padrão do
// cacheControlUnsupported acima.
let streamingUnsupported = false;

export async function callClaude({ messages, system, tools, toolChoice, apiKey, model, signal, timeoutMs = 120000, gatewayUrl, onRetry, maxTokens = 8192, effort = EFFORT_HIGH, onDelta }) {
  const baseUrl = (gatewayUrl || DEFAULT_GATEWAY_URL).replace(/\/$/, '');
  const modelName = model || DEFAULT_MODEL;
  const transport = modelTransport(modelName);
  let dropTemperature = false;
  let enableCache = transport === 'anthropic' && !cacheControlUnsupported;
  let enableStream = transport === 'anthropic' && !streamingUnsupported && typeof onDelta === 'function';
  let request = buildRequest({
    transport, baseUrl, messages, system, tools, toolChoice, model: modelName, maxTokens, apiKey, effort, enableCache, enableStream,
  });
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const retry = async (describe) => {
      if (attempt >= maxAttempts) return false;
      if (onRetry) onRetry(describe, attempt, maxAttempts);
      await abortableDelay(RETRY_DELAYS_MS[attempt - 1], signal);
      return true;
    };

    let res;
    const combined = combineSignals(signal, timeoutMs);
    try {
      res = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: combined.signal,
        // Sem cookies: o gateway prioriza o cookie de sessão FlowToken sobre a
        // API key; um cookie expirado no perfil derruba a chamada com 401.
        credentials: 'omit',
      });
    } catch (e) {
      combined.dispose();
      if (e.name === 'AbortError') throw e;
      if (e.name === 'TimeoutError') {
        if (await retry(`tempo limite de ${Math.round(timeoutMs / 1000)}s`)) continue;
        throw new Error(`Tempo limite (${Math.round(timeoutMs / 1000)}s) ao chamar o modelo. Verifique a conexão/VPN ou troque o Gateway URL nas ⚙️ Configurações.`);
      }
      if (await retry(`falha de rede (${e.message})`)) continue;
      throw new Error(`Falha de rede ao chamar o modelo: ${e.message}`);
    }
    combined.dispose();

    if (!res.ok) {
      if (RETRYABLE_STATUS.has(res.status) && await retry(`erro ${res.status} do gateway`)) continue;
      const err = await res.json().catch(() => ({}));
      const message = err.error?.message || err.message || `Erro ${res.status} do gateway`;

      // Modelo que recusa `temperature`: refaz a chamada sem ele, uma única vez.
      if (res.status === 400 && transport === 'openai' && !dropTemperature && /temperature/i.test(message)) {
        dropTemperature = true;
        request = buildRequest({
          transport, baseUrl, messages, system, tools, toolChoice,
          model: modelName, maxTokens, apiKey, effort, dropTemperature: true, enableCache,
        });
        continue;
      }

      // Proxy sem suporte a cache_control: refaz sem ele, uma única vez, e desliga para
      // o resto da sessão (não vale a pena repetir esse retry a cada turno do loop).
      if (res.status === 400 && transport === 'anthropic' && enableCache && /cache_control/i.test(message)) {
        cacheControlUnsupported = true;
        enableCache = false;
        request = buildRequest({
          transport, baseUrl, messages, system, tools, toolChoice,
          model: modelName, maxTokens, apiKey, effort, dropTemperature, enableCache, enableStream,
        });
        continue;
      }

      // Proxy sem suporte a stream:true: refaz sem ele, uma única vez, e desliga para o
      // resto da sessão. A chamada volta a ser não-streaming (o loop já lida com onDelta
      // ausente/nunca chamado).
      if (res.status === 400 && transport === 'anthropic' && enableStream && /stream/i.test(message)) {
        streamingUnsupported = true;
        enableStream = false;
        request = buildRequest({
          transport, baseUrl, messages, system, tools, toolChoice,
          model: modelName, maxTokens, apiKey, effort, dropTemperature, enableCache, enableStream,
        });
        continue;
      }

      let hint = '';
      if ([502, 503, 504].includes(res.status)) hint = ' — o gateway está indisponível no momento. Verifique a VPN/conexão e tente novamente em instantes, ou troque o Gateway URL em ⚙️ Configurações.';
      else if ([401, 403].includes(res.status)) hint = ' — verifique a API Key em ⚙️ Configurações.';
      else if (res.status === 429) hint = ' — limite de requisições atingido; aguarde um pouco e tente novamente.';
      // O proxy Flow devolve exatamente isto quando a rota OpenAI não está liberada para
      // o token — o modelo existe em /v1/models, mas é inalcançável por ela.
      else if (/path .?chat\/completions.? is not allowed/i.test(message)) hint = ` — o seu token do Flow não libera a rota OpenAI (/v1/chat/completions), então modelos GPT e Gemini não funcionam por aqui. Escolha um modelo Anthropic (Haiku, Sonnet ou Opus) no seletor do chat.`;
      else if (res.status === 404 || /model/i.test(message)) hint = ` — o modelo "${modelName}" pode não existir ou não estar liberado para o seu token no Flow. Use "↻ Atualizar do proxy" no seletor de modelo para ver os IDs válidos.`;
      else if (transport === 'openai' && /tool|function/i.test(message)) hint = ` — o modelo "${modelName}" não lidou com as ferramentas do agente. Use o modo Chat/Tradutor, ou troque para Haiku/Sonnet.`;
      throw new Error(message + hint);
    }

    let parsed;
    const isSSE = (res.headers.get('content-type') || '').includes('event-stream');
    if (enableStream && isSSE) {
      try {
        parsed = await streamAnthropicResponse(res, onDelta);
      } catch (e) {
        // Corpo em streaming ilegível (proxy que devolve SSE malformado): cai pro fetch
        // não-streaming, uma única vez, e desliga stream para o resto da sessão.
        streamingUnsupported = true;
        enableStream = false;
        request = buildRequest({
          transport, baseUrl, messages, system, tools, toolChoice,
          model: modelName, maxTokens, apiKey, effort, dropTemperature, enableCache, enableStream,
        });
        if (await retry(`falha ao interpretar streaming (${e.message})`)) continue;
        throw new Error(`Falha ao interpretar a resposta em streaming do gateway: ${e.message}`);
      }
    } else {
      parsed = request.parse(await res.json());
      // Proxy ignorou stream:true e devolveu o JSON completo de uma vez (200 OK, sem
      // content-type de SSE): o onDelta ainda recebe o texto final, de uma vez só, para a
      // UI não ficar esperando chunks que nunca chegam.
      if (enableStream && onDelta && parsed?.text) {
        try { onDelta(parsed.text); } catch (_) {}
      }
    }
    const usage = parsed?.usage;
    if (usage) {
      const inTokens = usage.input_tokens ?? usage.prompt_tokens ?? '?';
      const outTokens = usage.output_tokens ?? usage.completion_tokens ?? '?';
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      console.debug(`[gateway] tokens in=${inTokens} out=${outTokens} cache_write=${cacheWrite} cache_read=${cacheRead}`);
    }
    return parsed;
  }
}
