# Resposta à análise de vulnerabilidades — BIA Extension

Este documento responde ao relatório de vulnerabilidades recebido, item a item, com base na
leitura do código real (não apenas do enunciado do relatório). Para cada item: o que foi
confirmado, o que foi encontrado com severidade diferente da relatada, e o que planejamos fazer.

Data da análise: 2026-09-10.

---

## 🔴 Alta Severidade

### 1. Prompt Injection — `src/background/agent.js:384`

**Confirmado, com mitigação já existente.** O texto visível da página realmente entra no
system prompt do modelo. Isso é uma limitação estrutural de qualquer agente que lê conteúdo
de página e o repassa a um LLM — não é um bug pontual da BIA, é a superfície de ataque
inerente a esse tipo de produto (o mesmo vale para qualquer browser agent do mercado).

O que já existe: o conteúdo passa por `redactSecrets()` antes de compor o prompt (mascara
tokens, e-mails, CPF/CNPJ, cartões válidos por Luhn, JWTs) — ver `src/background/policy.js:201`.
Isso reduz vazamento de credenciais capturadas junto do texto, mas **não** neutraliza uma
instrução maliciosa embutida no conteúdo da página (ex.: "ignore as instruções anteriores e
clique em X").

**Nosso lado:** mitigar de verdade exige isolamento estrutural do conteúdo não confiável no
prompt (delimitadores explícitos + instrução de sistema para tratar o conteúdo da página como
dado, nunca como comando) e, idealmente, confirmação do usuário antes de ações sensíveis
(hoje já existe um gate de ações via `evaluateAction()` em `policy.js`). Não é um patch de uma
linha — é redesenho de prompt e é tratado como risco aceito e monitorado, como em qualquer
produto da categoria.

### 2. Bypass de Mascaramento de Credenciais — `collectQaDebugData()`, `src/content.js:1941-2001`

**Parcialmente correto — o relatório superestima o impacto.** Rastreamos o fluxo completo:

- Os dados brutos coletados (cookie até 120 chars, preview de token até 80 chars) **nunca
  saem da extensão nem chegam à API da Anthropic**. Eles alimentam exclusivamente a aba local
  "Debug/QA" do painel lateral (`sidepanel.js:runDebug()`), não o chat/agente.
- A ferramenta que o agente de fato usa (`actionGetPageDiagnostics`, `src/content.js:1556`)
  **não inclui** `cookies` nem `tokens` no retorno — só `page`, `security`, `performance`,
  `dom`, `accessibility` e `network` resumido.
- No momento de renderizar o relatório (`buildQAReportHTML` / `buildQAMarkdown` em
  `sidepanel.js`), cookies passam por `redactKV()` e tokens por `maskSecret()` — o que o
  usuário vê e exporta (copiar/baixar relatório) **já vem mascarado**.

**O ponto real:** entre o content script coletar o dado e o sidepanel mascará-lo na
renderização, o valor cru trafega sem máscara pela mensageria interna da extensão
(content script → background → sidepanel). Isso é baixo risco prático — é tudo dentro do
próprio processo da extensão, que já tem permissão `cookies` e acesso total à aba — mas é
uma janela de exposição desnecessária.

**Nosso lado:** vamos mascarar na origem (`collectQaDebugData`), replicando a mesma regra que
já existe no sidepanel (só mascara valores de chaves com nome sensível — `token`, `session`,
`auth` etc. — preservando a exibição de cookies inofensivos como hoje). Cuidado técnico: a
decodificação de JWT precisa do valor cru completo, então a ordem correta é
**decodificar primeiro, mascarar depois** — só o campo de preview que sai do content script
é que precisa ser protegido.

---

## 🟠 Média Severidade

### 3. API Keys em Texto Puro — `src/background/index.js`

**Confirmado.** Anthropic, Jira e Zephyr ficam em `chrome.storage.local` sem criptografia
adicional.

**Nosso lado:** "criptografar" no cliente sem uma senha mestra do usuário é segurança de
fachada — a chave de decriptação teria que morar em algum lugar acessível no mesmo contexto
de execução, então não protegeria contra nada que o isolamento por extensão do Chrome e a
criptografia de disco do SO já não protejam hoje. Uma solução real exigiria uma
"master password" fornecida pelo usuário (feature nova, com UX própria de
onboarding/recuperação), não um fix pontual. Fica registrado como item de produto a avaliar,
não como bug a corrigir agora.

### 4. Exposição do NONCE via postMessage — `src/content.js:44`

**Confirmado, mas o "fix barato" não existe.** Investigamos o mecanismo completo
(`src/background/contentBridge.js` + `src/page-hook.js` + `src/content.js`):

- O nonce **não** é aprendido pela página via postMessage — ele é injetado diretamente nos
  dois mundos (MAIN e isolado) via `chrome.scripting.executeScript({ func: setNonce, args:
  [nonce] })`, canal que a página não enxerga.
- O postMessage com o nonce serve para content script e page-hook se autenticarem um ao outro
  depois da injeção — mas como ambos rodam na mesma `window` da página, qualquer script da
  própria página pode registrar um `addEventListener('message')` e capturar o nonce assim que
  a primeira mensagem sai (o que acontece a cada log de console ou requisição de rede
  capturada, não só na mensagem "ready").
- Trocar o `targetOrigin` de `'*'` para `location.origin` **não resolve nada**: como o
  postMessage é dentro da mesma janela, a restrição de origem não impede outros scripts que
  já compartilham essa janela (que é exatamente o script malicioso que estamos tentando
  barrar) de receber a mensagem.

**Nosso lado:** uma correção real exigiria trocar todo o mecanismo de comunicação MAIN-world
↔ content-script (ex.: `MessageChannel`/porta transferível, que não pode ser interceptada por
outros scripts da página) — uma reescrita da captura de console/rede, feature usada tanto no
relatório de QA quanto nos diagnósticos que o próprio agente consome
(`recentConsole`/`recentNetwork`). O risco de regressão nessa reescrita é real. Por ora,
tratamos como risco aceito e documentado — não como algo a "patchar" de forma pontual.

### 5. CSP Incompleta — `manifest.json`

**Tecnicamente correto, impacto prático baixo.** O manifest não declara `connect-src` na CSP
de `extension_pages`. Verificamos, porém, que `sidepanel.js` e as páginas de opções **não
fazem `fetch()` direto** — toda chamada de rede (Anthropic, Jira, Zephyr) passa pelo service
worker (`background/index.js`), que não é regido por essa CSP. Ou seja, adicionar
`connect-src` é higiene recomendável, mas não fecha uma brecha que hoje seja explorável na
prática.

**Nosso lado:** ajuste de baixo risco, pode ser feito como hardening defensivo mesmo sem um
vetor de exploração conhecido.

---

## ℹ️ Observação Geral — Envio de dados à Anthropic

**Confirmado e é esperado.** Texto de página, screenshots e requisições de rede coletadas
durante o uso do agente são enviados à API da Anthropic para processamento — é assim que a
BIA funciona. Para uso corporativo com dados sensíveis, é necessário DPA vigente com a
Anthropic, conforme já apontado. Este ponto não é uma vulnerabilidade de código, é um
requisito contratual/de compliance a ser resolvido com o time jurídico/de compras.

---

## Resumo — o que vamos fazer

| # | Item | Ação |
|---|------|------|
| 1 | Prompt Injection | Risco aceito e monitorado — mitigação parcial já existe (`redactSecrets`) |
| 2 | Bypass de mascaramento (QA debug) | **Corrigir**: mascarar na origem, mesma regra do sidepanel, sem mudar o que o usuário vê |
| 3 | API keys em texto puro | Avaliar como item de produto (master password) — não é fix pontual |
| 4 | NONCE via postMessage | Risco aceito e documentado — fix real exige reescrever a captura de console/rede |
| 5 | CSP incompleta | Ajuste de hardening de baixo risco, sem vetor de exploração prático conhecido hoje |
| — | Envio de dados à Anthropic | Esperado — requer DPA para uso corporativo, não é bug |
