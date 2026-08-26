import { DEFAULT_MAX_STEPS, clampMaxSteps, sanitizePathSegment, looksLikeUrl } from '../shared/constants.js';
import { parseEnvironments } from '../shared/vars.js';
import { computeFlakyMap, summarizeMetrics, buildDailyTrend, buildPrioritySuggestions, aggregateBy } from '../shared/insights.js';
import { TEMPLATE_PACKS } from '../shared/templates.js';

const $ = (id) => document.getElementById(id);

// `model` saiu daqui: o modelo do chat é escolhido no seletor do composer e os testes da
// aba Executar usam DEFAULT_MODEL. Um valor antigo em storage.model continua sendo
// respeitado (ver startAgentRun), para não mudar o comportamento de quem já configurou.
const FIELDS = {
  apiKey: 'apiKey',
  gatewayUrl: 'gatewayUrlInput',
  environmentsJson: 'environmentsInput',
  jiraUrl: 'jiraUrl',
  jiraEmail: 'jiraEmail',
  jiraToken: 'jiraToken',
  jiraProjectKey: 'jiraProjectKey',
  zephyrBaseUrl: 'zephyrBaseUrl',
  zephyrToken: 'zephyrToken',
  zephyrProjectKey: 'zephyrProjectKey',
};

let uiLang = 'pt';
const tt = (pt, en) => (uiLang === 'en' ? en : pt);
const dateLocale = () => (uiLang === 'en' ? 'en-US' : 'pt-BR');

const FEATURES = [
  { key: 'accessibilityButton', name: 'Botão do Modo Acessível', desc: 'Botão no topo do painel que liga/desliga o modo acessível (respostas em voz alta e comandos por microfone, para pessoas com deficiência visual). Desligue para esconder o botão — o estado atual do modo é mantido.',
    nameEn: 'Accessible Mode button', descEn: 'Button at the top of the panel that toggles accessible mode (spoken replies and microphone commands, for visually impaired users). Turn off to hide the button — the current mode state is kept.' },
  { key: 'runTab',           name: 'Aba Executar',               desc: 'Modo teste clássico: test case com veredito, relatório e evidências. Desligue para deixar só o chat da Bia.',
    nameEn: 'Run tab', descEn: 'Classic test mode: test case with verdict, report and evidence. Turn off to keep only Bia\'s chat.' },
  { key: 'libraryTab',       name: 'Aba Testes (biblioteca)',    desc: 'Biblioteca de test cases salvos, suites, tags e execução em lote.',
    nameEn: 'Tests tab (library)', descEn: 'Library of saved test cases, suites, tags and batch execution.' },
  { key: 'recorder',         name: 'Gravador de ações',          desc: 'Botão "Gravar" na aba Executar: captura seus cliques e digitação na página e gera o test case automaticamente.',
    nameEn: 'Action recorder', descEn: '"Record" button in the Run tab: captures your clicks and typing on the page and generates the test case automatically.' },
  { key: 'batch',            name: 'Execução em lote',           desc: 'Checkboxes na biblioteca, "Executar selecionados" e "Executar suite" — roda vários test cases em sequência com resumo final.',
    nameEn: 'Batch execution', descEn: 'Checkboxes in the library, "Run selected" and "Run suite" — runs several test cases in sequence with a final summary.' },
  { key: 'dataDriven',       name: 'Data-driven (Dados)',        desc: 'Campo "Dados" na aba Executar: dataset JSON que roda o mesmo teste uma vez por linha, preenchendo {{variáveis}}.',
    nameEn: 'Data-driven (Data)', descEn: '"Data" field in the Run tab: a JSON dataset runs the same test once per row, filling in {{variables}}.' },
  { key: 'environments',     name: 'Ambientes',                  desc: 'Seletor de ambiente na aba Executar e variáveis {{nome}} vindas do Environments (JSON) das Configurações.',
    nameEn: 'Environments', descEn: 'Environment selector in the Run tab and {{name}} variables from the Environments (JSON) in Settings.' },
  { key: 'agentScreenshots', name: 'Visão do agente (screenshots)', desc: 'Envio de capturas de tela ao modelo durante a execução. Desligue em ambientes com dados sensíveis — o agente passa a operar só por texto/DOM.',
    nameEn: 'Agent vision (screenshots)', descEn: 'Sends screenshots to the model during execution. Turn off in environments with sensitive data — the agent operates on text/DOM only.' },
  { key: 'devtoolsInspect',  name: 'Inspeção DevTools no chat',  desc: 'Deixa a Bia ler storage, cookies (inclusive HttpOnly), headers e corpo de requisições para responder perguntas. Valores de token/JWT vêm sempre mascarados; revelar um valor cru exige confirmação sua. Desligue para tirar esse acesso por completo.',
    nameEn: 'DevTools inspection in chat', descEn: 'Lets Bia read storage, cookies (including HttpOnly), headers and request bodies to answer questions. Token/JWT values are always masked; revealing a raw value requires your confirmation. Turn off to remove this access entirely.' },
  { key: 'debugTab',         name: 'Aba Debug',                  desc: 'Raio-x da página: segurança, acessibilidade, performance, tokens, rede e erros JS.',
    nameEn: 'Debug tab', descEn: 'Page x-ray: security, accessibility, performance, tokens, network and JS errors.' },
  { key: 'inspectTab',       name: 'Aba Inspetor',               desc: 'Clique em elementos da página para ver seletor, XPath, role e atributos.',
    nameEn: 'Inspector tab', descEn: 'Click page elements to see the best selector, XPath, role and attributes.' },
  { key: 'jira',             name: 'Integração Jira',            desc: 'Botões "Criar Bug no Jira" nos resultados (exige configuração na aba Configurações).',
    nameEn: 'Jira integration', descEn: '"Create Jira Bug" buttons on results (requires configuration in the Settings tab).' },
  { key: 'zephyr',           name: 'Integração Zephyr',          desc: '"Enviar ao Zephyr" no resultado de testes importados do Zephyr (exige configuração).',
    nameEn: 'Zephyr integration', descEn: '"Send to Zephyr" on results of tests imported from Zephyr (requires configuration).' },
  { key: 'pdfExport',        name: 'Exportar PDF',               desc: 'Botões de exportação de relatório em PDF na execução única e no lote.',
    nameEn: 'PDF export', descEn: 'PDF report export buttons for single runs and batches.' },
  { key: 'suggestions',      name: 'Sugestão de test cases (IA)', desc: 'Botão "💡 Sugerir" na biblioteca: a IA analisa a página atual e propõe test cases prontos para salvar.',
    nameEn: 'Test case suggestions (AI)', descEn: '"💡 Suggest" button in the library: the AI analyzes the current page and proposes ready-to-save test cases.' },
  { key: 'videoRecording',   name: 'Vídeo da execução',           desc: 'Grava um vídeo .webm da execução (screencast via CDP, montado no painel) — disponível no resultado enquanto o painel estiver aberto.',
    nameEn: 'Execution video', descEn: 'Records a .webm video of the run (CDP screencast, assembled in the panel) — available on the result while the panel is open.' },
  { key: 'visualBaseline',   name: 'Regressão visual (baseline)', desc: 'Compara a tela final de cada teste salvo com o baseline armazenado e mostra o Δ% com destaque das diferenças.',
    nameEn: 'Visual regression (baseline)', descEn: 'Compares each saved test\'s final screen with the stored baseline and shows the Δ% with differences highlighted.' },
];

let isDarkMode = false;
let themeMode = 'system';
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');
systemDarkQuery.addEventListener('change', () => { if (themeMode === 'system') applyTheme(); });

function loadTheme() {
  chrome.storage.local.get(['themeMode', 'darkMode'], (r) => {
    themeMode = r.themeMode || (r.darkMode === true ? 'dark' : r.darkMode === false ? 'light' : 'system');
    $('themeSelect').value = themeMode;
    applyTheme();
  });
}

// Trava de login Google (OIDC), restrita a @ciandt.com. Se OIDC_CLIENT_ID estiver vazio
// (modo dev/open-source), o background responde { required: false } e nada aparece aqui —
// nem o overlay nem a caixa de e-mail/Sair no header — comportamento atual inalterado.
function initAuthGate() {
  const gate = $('authGate');
  const signInBtn = $('authSignInBtn');
  const errorEl = $('authGateError');
  const userBox = $('authUserBox');
  const userEmailEl = $('authUserEmail');
  const signOutBtn = $('authSignOutBtn');
  if (!gate || !signInBtn) return;

  const refreshStatus = () => {
    chrome.runtime.sendMessage({ action: 'authStatus' }, (res) => {
      if (chrome.runtime.lastError) return;
      const required = !!res?.required;
      const session = res?.session || null;
      gate.classList.toggle('hidden', !(required && !session));
      if (required && session) {
        userBox.classList.remove('hidden');
        userEmailEl.textContent = session.email || '';
      } else {
        userBox.classList.add('hidden');
      }
    });
  };
  refreshStatus();

  signInBtn.addEventListener('click', () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Entrando…';
    errorEl.classList.add('hidden');
    chrome.runtime.sendMessage({ action: 'authSignIn' }, (res) => {
      signInBtn.disabled = false;
      signInBtn.textContent = 'Entrar com Google';
      if (chrome.runtime.lastError) {
        errorEl.textContent = 'Não foi possível entrar. Tente novamente.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (res?.success) { refreshStatus(); return; }
      errorEl.textContent = res?.message || 'Não foi possível entrar. Tente novamente.';
      errorEl.classList.remove('hidden');
    });
  });

  signOutBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'authSignOut' }, () => refreshStatus());
  });
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['language'], (lr) => {
    uiLang = lr.language === 'en' ? 'en' : 'pt';
    if (uiLang === 'en') applyEnglishDashUI();
    initDashboard();
  });
});

function initDashboard() {
  loadTheme();
  loadAll();
  refreshLibraryStats();
  renderFeatureToggles();
  renderPresets();
  renderTemplates();
  renderManual();
  renderMetrics();
  initAuthGate();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.runHistory || changes.savedTests)) {
      renderMetrics();
      refreshLibraryStats();
      renderZephyrExportSelect();
    }
    if (area === 'local' && changes.themeMode) loadTheme();
    if (area === 'local' && changes.featureFlags) {
      renderFeatureToggles();
      syncVideoEnabled(changes.featureFlags.newValue || {});
      $('modelModeSelect').value = (changes.featureFlags.newValue || {}).modelMode || 'sonnet';
    }
    if (area === 'local' && changes.language) {
      const next = changes.language.newValue === 'en' ? 'en' : 'pt';
      if (next !== uiLang) location.reload();
    }
  });

  document.querySelectorAll('.dash-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchDashTab(btn.dataset.tab));
  });

  $('darkToggleBtn').addEventListener('click', () => {
    themeMode = themeMode === 'system' ? 'dark' : themeMode === 'dark' ? 'light' : 'system';
    $('themeSelect').value = themeMode;
    chrome.storage.local.set({ themeMode });
    applyTheme();
  });
  $('themeSelect').addEventListener('change', () => {
    themeMode = $('themeSelect').value;
    chrome.storage.local.set({ themeMode });
    applyTheme();
  });
  $('langSelect').value = uiLang;
  $('langSelect').addEventListener('change', (e) => {
    chrome.storage.local.set({ language: e.target.value === 'en' ? 'en' : 'pt' }, () => location.reload());
  });
  $('videoAutoSave').addEventListener('change', (e) => {
    chrome.storage.local.set({ videoAutoSave: e.target.checked });
  });
  $('downloadFolder').addEventListener('change', (e) => {
    const folder = sanitizePathSegment(e.target.value.trim());
    e.target.value = folder;
    chrome.storage.local.set({ downloadFolder: folder });
  });
  $('downloadAskWhere').addEventListener('change', (e) => {
    chrome.storage.local.set({ downloadAskWhere: e.target.checked });
  });
  $('videoEnabled').addEventListener('change', (e) => {
    chrome.storage.local.get(['featureFlags'], (r) => {
      const updated = { ...(r.featureFlags || {}) };
      if (e.target.checked) delete updated.videoRecording;
      else updated.videoRecording = false;
      chrome.storage.local.set({ featureFlags: updated });
    });
  });
  $('modelModeSelect').addEventListener('change', (e) => {
    chrome.storage.local.get(['featureFlags'], (r) => {
      const updated = { ...(r.featureFlags || {}) };
      // Ausente = 'sonnet' (comportamento atual) — Auto é opt-in.
      if (e.target.value === 'sonnet') delete updated.modelMode;
      else updated.modelMode = e.target.value;
      chrome.storage.local.set({ featureFlags: updated });
    });
  });
  $('saveBtn').addEventListener('click', saveAll);
  $('zephyrImportBtn').addEventListener('click', importFromZephyr);
  $('zephyrExportBtn').addEventListener('click', exportToZephyr);
  renderZephyrExportSelect();
  $('exportLibraryBtn').addEventListener('click', exportLibrary);
  $('importLibraryBtn').addEventListener('click', () => $('importLibraryFile').click());
  $('importLibraryFile').addEventListener('change', importLibrary);
}

function applyEnglishDashUI() {
  const ops = [
    ['.dash-tab[data-tab="config"]', 'text', '⚙️ Settings'],
    ['.dash-tab[data-tab="metrics"]', 'text', '📈 Metrics'],
    ['.dash-tab[data-tab="features"]', 'text', '🧩 Features'],
    ['.dash-tab[data-tab="templates"]', 'text', '🧰 Templates'],
    ['.dash-tab[data-tab="manual"]', 'text', '📖 Manual'],
    ['#apiKey', 'placeholder', 'Paste your API Key here'],
    ['#saveBtn', 'text', 'Save settings'],
    ['#zephyrExportBtn', 'text', '⬆ Export'],
    ['#zephyrImportBtn', 'text', '⬇ Import'],
    ['#zephyrImportKey', 'placeholder', 'TC key (e.g. PROJ-T123)'],
    ['#zephyrExportSelect option[value=""]', 'text', 'Select a test…'],
    ['#exportLibraryBtn', 'text', '⬆ Export JSON'],
    ['#importLibraryBtn', 'text', '⬇ Import JSON'],
    ['#jiraToken', 'placeholder', 'Jira token'],
    ['#zephyrToken', 'placeholder', 'Zephyr Scale token'],
    ['#downloadFolder', 'placeholder', 'E.g.: flow-qa (subfolder inside Downloads)'],
  ];
  for (const [sel, kind, value] of ops) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (kind === 'text') el.textContent = value;
    else el.setAttribute(kind, value);
  }

  const LABELS_EN = {
    'Modelo': 'Model',
    'Modelo do agente': 'Agent model',
    'Limite de ciclos': 'Max cycles',
    'Tema': 'Theme',
    'Vídeo da execução': 'Execution video',
    'Onde salvar vídeos e prints': 'Where to save videos and screenshots',
    'URL do Jira': 'Jira URL',
    'E-mail': 'Email',
    'Environments (JSON)': 'Environments (JSON)',
    'Exportar teste da biblioteca para o Zephyr': 'Export a library test to Zephyr',
    'Importar test case do Zephyr para a biblioteca': 'Import a Zephyr test case into the library',
  };
  document.querySelectorAll('#tab-config label').forEach((l) => {
    const key = (l.childNodes[0]?.textContent || '').trim();
    if (LABELS_EN[key]) l.childNodes[0].textContent = LABELS_EN[key] + ' ';
  });

  const H2_EN = {
    '🤖 Agente': '🤖 Agent',
    '🌍 Ambientes': '🌍 Environments',
    '📚 Biblioteca de testes': '📚 Test library',
    '👤 Perfis rápidos': '👤 Quick profiles',
    '🧩 Funcionalidades da extensão': '🧩 Extension features',
  };
  document.querySelectorAll('h2').forEach((h) => {
    const key = h.textContent.trim();
    if (H2_EN[key]) h.textContent = H2_EN[key];
  });

  document.querySelectorAll('.badge-optional').forEach((b) => { b.textContent = 'optional'; });
  document.querySelectorAll('.link-sm').forEach((a) => { if (a.textContent.includes('gerar')) a.textContent = 'generate →'; });

  const themeOpts = document.querySelectorAll('#themeSelect option');
  const themeEn = ['Follow the system', 'Light', 'Dark'];
  themeOpts.forEach((o, i) => { if (themeEn[i]) o.textContent = themeEn[i]; });

  const modelModeOpts = document.querySelectorAll('#modelModeSelect option');
  const modelModeEn = ['Auto — fast with quality (recommended)', 'Sonnet — top quality', 'Haiku — top speed'];
  modelModeOpts.forEach((o, i) => { if (modelModeEn[i]) o.textContent = modelModeEn[i]; });

  const checks = {
    'Gravar vídeo das execuções': 'Record video of runs',
    'Baixar automaticamente ao concluir': 'Download automatically when finished',
    'Perguntar onde salvar a cada download': 'Ask where to save on every download',
  };
  document.querySelectorAll('.check-inline').forEach((l) => {
    const txt = l.textContent.trim();
    if (checks[txt]) {
      const input = l.querySelector('input');
      l.textContent = ' ' + checks[txt];
      l.prepend(input);
    }
  });

  const hints = [
    // Aplicado com textContent, então nada de HTML aqui — sairia literal.
    ['O modelo é escolhido direto no chat', 'The model is picked right in the chat, in the selector next to the clock — each conversation can use a different one. Automated runs follow the "Agent model" setting below.'],
    ['O Chrome só grava dentro de Downloads', 'Chrome only saves inside Downloads without opening the folder picker — check "Ask" to choose any folder each time.'],
    ['Vazio = API direta', 'Empty = direct Anthropic API. Any compatible gateway (LiteLLM etc.) works — the API key must match the configured provider.'],
    ['Variáveis disponíveis como', 'Variables available as {{name}} in the test case. The active environment is picked in the panel\'s Run tab.'],
    ['E-mail em branco', 'Leave email blank to use the token as a Personal Access Token (Jira Server/DC).'],
    ['Exporte para versionar', 'Export to version/share test cases with your team; import merges by id (no duplicates).'],
    ['Aplique um preset de funcionalidades', 'Apply a feature preset based on who uses the extension — then fine-tune the switches individually if needed.'],
    ['Desligue o que o seu time não usa', 'Turn off what your team doesn\'t use — the feature disappears from the panel instantly and comes back when re-enabled. Changes are saved automatically.'],
  ];
  document.querySelectorAll('.form-hint').forEach((p) => {
    const txt = p.textContent.trim();
    for (const [prefix, en] of hints) {
      if (txt.startsWith(prefix)) { p.textContent = en; break; }
    }
  });
}

function switchDashTab(name) {
  document.querySelectorAll('.dash-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.dash-tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${name}`));
  $('configFooter').classList.toggle('hidden', name !== 'config');
}

function syncVideoEnabled(flags) {
  const enabled = flags.videoRecording !== false;
  $('videoEnabled').checked = enabled;
  $('videoAutoSave').disabled = !enabled;
  $('videoAutoSave').parentElement.style.opacity = enabled ? '' : '0.5';
}

function renderFeatureToggles() {
  chrome.storage.local.get(['featureFlags'], (r) => {
    const flags = r.featureFlags || {};
    const list = $('featureList');
    list.innerHTML = '';
    for (const f of FEATURES) {
      const enabled = flags[f.key] !== false;
      const item = document.createElement('div');
      item.className = 'feature-item';
      item.innerHTML = `
        <div class="feature-info">
          <b>${tt(f.name, f.nameEn)}</b>
          <span>${tt(f.desc, f.descEn)}</span>
        </div>
        <label class="switch">
          <input type="checkbox" data-key="${f.key}" ${enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>`;
      item.querySelector('input').addEventListener('change', (e) => {
        chrome.storage.local.get(['featureFlags'], (r2) => {
          const updated = { ...(r2.featureFlags || {}) };
          if (e.target.checked) delete updated[f.key];
          else updated[f.key] = false;
          chrome.storage.local.set({ featureFlags: updated });
        });
      });
      list.appendChild(item);
    }
  });
}

const PRESETS = [
  {
    name: 'QA completo',
    desc: 'Todas as funcionalidades ligadas',
    nameEn: 'Full QA',
    descEn: 'All features on',
    flags: {},
  },
  {
    name: 'Dev — executar e debugar',
    desc: 'Execução, Debug e Inspetor; sem gravador, lote e integrações',
    nameEn: 'Dev — run and debug',
    descEn: 'Run, Debug and Inspector; no recorder, batch or integrations',
    flags: { recorder: false, batch: false, dataDriven: false, zephyr: false, jira: false, suggestions: false, pdfExport: false },
  },
  {
    name: 'Genérico (mínimo)',
    desc: 'Só o agente na página, estilo assistente de browser',
    nameEn: 'Generic (minimal)',
    descEn: 'Just the agent on the page, browser-assistant style',
    flags: { recorder: false, batch: false, dataDriven: false, environments: false, debugTab: false, inspectTab: false, jira: false, zephyr: false, pdfExport: false, suggestions: false },
  },
  {
    name: 'Somente Chat (Bia)',
    desc: 'Esconde todas as abas e deixa apenas o chat da Bia',
    nameEn: 'Chat Only (Bia)',
    descEn: 'Hides every tab and keeps only Bia\'s chat',
    flags: { runTab: false, libraryTab: false, debugTab: false, inspectTab: false, recorder: false, batch: false, dataDriven: false, environments: false, jira: false, zephyr: false, pdfExport: false, suggestions: false, videoRecording: false, visualBaseline: false },
  },
];

function renderPresets() {
  const row = $('presetRow');
  row.innerHTML = '';
  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.innerHTML = `${tt(preset.name, preset.nameEn)}<small>${tt(preset.desc, preset.descEn)}</small>`;
    btn.addEventListener('click', () => {
      chrome.storage.local.set({ featureFlags: { ...preset.flags } }, () => {
        renderFeatureToggles();
        showStatus(tt(`✓ Perfil "${preset.name}" aplicado`, `✓ "${preset.nameEn}" profile applied`), 'success');
      });
    });
    row.appendChild(btn);
  }
}

function renderTemplates() {
  const el = $('templatesContent');
  el.innerHTML = `<p class="form-hint" style="margin-bottom:14px">${tt(
    'Test cases prontos por vertical — use <code>{{variáveis}}</code> com seus Ambientes. "Adicionar" salva na biblioteca (suite com o nome da vertical) para revisar e executar.',
    'Ready-made test cases by vertical — use <code>{{variables}}</code> with your Environments. "Add" saves to the library (suite named after the vertical) for review and execution. Template contents are in Portuguese.'
  )}</p>`;
  for (const pack of TEMPLATE_PACKS) {
    const section = document.createElement('section');
    section.className = 'card card-wide template-pack';
    section.innerHTML = `<h2>${pack.icon} ${pack.vertical}</h2>`;
    for (const tpl of pack.templates) {
      const item = document.createElement('div');
      item.className = 'template-item';
      item.innerHTML = `
        <div>
          <b>${escapeHtml(tpl.name)}</b>
          <details><summary>${tt('ver passos', 'view steps')}</summary><pre>${escapeHtml(tpl.prompt)}</pre></details>
        </div>
        <button class="template-add-btn">${tt('+ Adicionar', '+ Add')}</button>`;
      item.querySelector('.template-add-btn').addEventListener('click', (e) => {
        const btn = e.target;
        chrome.storage.local.get(['savedTests'], (r) => {
          const tests = r.savedTests || [];
          tests.unshift({
            id: Date.now(),
            name: tpl.name,
            prompt: tpl.prompt,
            savedAt: new Date().toLocaleString('pt-BR'),
            tags: ['template'],
            suite: pack.vertical,
          });
          chrome.storage.local.set({ savedTests: tests }, () => {
            btn.textContent = tt('✓ Adicionado', '✓ Added');
            btn.disabled = true;
            refreshLibraryStats();
          });
        });
      });
      section.appendChild(item);
    }
    el.appendChild(section);
  }
}

function fmtDuration(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function renderMetrics() {
  chrome.storage.local.get(['runHistory', 'savedTests'], (r) => {
    const history = r.runHistory || [];
    const tests = r.savedTests || [];
    const el = $('metricsContent');

    if (history.length === 0) {
      el.innerHTML = `<section class="card card-wide"><h2>${tt('📈 Métricas', '📈 Metrics')}</h2><p class="metrics-empty">${tt(
        'Nenhuma execução registrada ainda. Rode alguns testes — cada execução (única ou em lote) passa a alimentar as métricas automaticamente.',
        'No runs recorded yet. Run some tests — every run (single or batch) feeds the metrics automatically.'
      )}</p></section>`;
      return;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff30 = Date.now() - 30 * dayMs;
    const recent = history.filter((h) => (h.ts || 0) >= cutoff30);
    const today = history.filter((h) => (h.ts || 0) >= startOfToday.getTime());
    const todayPassed = today.filter((h) => h.status === 'passed').length;
    const todayFailed = today.filter((h) => h.status === 'failed').length;
    const lastRun = history[history.length - 1];

    const m = summarizeMetrics(history, 30);
    const trend = buildDailyTrend(history, 14);
    const flaky = computeFlakyMap(history);
    const priority = buildPrioritySuggestions(history, tests, 8);
    const testById = new Map(tests.map((t) => [t.id, t]));
    const executedIds = new Set(history.filter((h) => h.testId).map((h) => h.testId));
    const neverRun = tests.filter((t) => !executedIds.has(t.id)).length;

    const statusMeta = {
      passed: ['✅', tt('Aprovado', 'Passed')],
      failed: ['❌', tt('Reprovado', 'Failed')],
      inconclusive: ['⚠️', tt('Inconclusivo', 'Inconclusive')],
    };
    const lastMeta = statusMeta[lastRun?.status] || ['⚠️', lastRun?.status || '?'];

    const heroHtml = `
      <div class="mx-hero">
        <div class="mx-hero-today">
          📅 ${tt('Hoje', 'Today')}: <b>${today.length}</b> ${tt('execução(ões)', 'run(s)')}
          <span class="mx-sep">·</span><span style="color:var(--ok)">✅ ${todayPassed}</span>
          <span class="mx-sep">·</span><span style="color:#dc2626">❌ ${todayFailed}</span>
          <span class="mx-sep">·</span><span style="color:#d97706">⚠️ ${today.length - todayPassed - todayFailed}</span>
        </div>
        <div class="mx-hero-last">
          ${tt('Última execução', 'Last run')}: ${lastMeta[0]} ${escapeHtml((lastRun?.name || '').slice(0, 60))}<br>
          ${escapeHtml(new Date(lastRun?.ts || Date.now()).toLocaleString(dateLocale()))}${lastRun?.env ? ` · ${tt('ambiente', 'environment')} ${escapeHtml(lastRun.env)}` : ''}
        </div>
      </div>`;

    const decided = m.passed + m.failed;
    const passPct = decided > 0 ? (m.passed / decided) * 100 : 0;
    const passDeg = m.total > 0 ? (m.passed / m.total) * 360 : 0;
    const failDeg = m.total > 0 ? (m.failed / m.total) * 360 : 0;
    const donutHtml = `
      <div class="metric-card mx-donut-card" style="grid-column: span 2">
        <div class="mx-donut" style="background: conic-gradient(var(--ok) 0deg ${passDeg}deg, #dc2626 ${passDeg}deg ${passDeg + failDeg}deg, #d97706 ${passDeg + failDeg}deg 360deg)">
          <span class="${passPct >= 80 ? 'metric-value ok' : passPct < 50 ? 'metric-value bad' : ''}" style="font-size:14px">${m.passRate === null ? '—' : Math.round(passPct) + '%'}</span>
        </div>
        <div class="mx-legend">
          <div><i style="background:var(--ok)"></i>${m.passed} ${tt('aprovados', 'passed')}</div>
          <div><i style="background:#dc2626"></i>${m.failed} ${tt('reprovados', 'failed')}</div>
          <div><i style="background:#d97706"></i>${m.inconclusive} ${tt('inconclusivos', 'inconclusive')}</div>
        </div>
      </div>`;

    const card = (icon, value, label, cls = '') =>
      `<div class="metric-card"><span class="metric-icon">${icon}</span><div><div class="metric-value ${cls}">${value}</div><div class="metric-label">${label}</div></div></div>`;

    const maxDay = Math.max(1, ...trend.map((d) => d.passed + d.failed + d.other));
    const px = (n) => (n > 0 ? Math.max(4, Math.round((n / maxDay) * 104)) : 0);
    const trendHtml = trend.map((d, i) => {
      const total = d.passed + d.failed + d.other;
      const isToday = i === trend.length - 1;
      return `<div class="mx-day${isToday ? ' mx-today' : ''}" title="${d.day}: ${d.passed} ✅ · ${d.failed} ❌ · ${d.other} ⚠️">
        <div class="mx-day-count">${total || ''}</div>
        <div class="mx-cols">
          ${d.other ? `<div class="bar-other" style="height:${px(d.other)}px"></div>` : ''}
          ${d.failed ? `<div class="bar-fail" style="height:${px(d.failed)}px"></div>` : ''}
          ${d.passed ? `<div class="bar-pass" style="height:${px(d.passed)}px"></div>` : ''}
        </div>
        <div class="mx-day-label">${isToday ? tt('hoje', 'today') : d.day.slice(0, 5)}</div>
      </div>`;
    }).join('');

    const noSuite = tt('Sem suite', 'No suite');
    const adhoc = tt('Execuções avulsas', 'Ad-hoc runs');
    const suiteById = new Map(tests.map((t) => [t.id, t.suite || noSuite]));
    const suites = aggregateBy(recent, (r2) => (r2.testId ? (suiteById.get(r2.testId) || noSuite) : adhoc));
    const rateBar = (rate) => {
      if (rate === null) return '<span class="mx-rate" style="color:var(--text-muted)">—</span>';
      const pct = Math.round(rate * 100);
      const cls = pct >= 80 ? '' : pct >= 50 ? 'mid' : 'low';
      return `<div style="display:flex;align-items:center;gap:8px"><div class="mx-bar-bg"><div class="mx-bar-fill ${cls}" style="width:${pct}%"></div></div><span class="mx-rate">${pct}%</span></div>`;
    };
    const suiteRows = suites.slice(0, 8).map((s) =>
      `<tr><td>${escapeHtml(String(s.key))}</td><td>${s.total}</td><td>${rateBar(s.passRate)}</td><td>${fmtDuration(s.avgDurationMs)}</td></tr>`
    ).join('');

    const envs = aggregateBy(recent, (r2) => r2.env || null);
    const envRows = envs.slice(0, 6).map((e) =>
      `<tr><td>🌍 ${escapeHtml(String(e.key))}</td><td>${e.total}</td><td>${rateBar(e.passRate)}</td><td>${fmtDuration(e.avgDurationMs)}</td></tr>`
    ).join('');

    const slowest = aggregateBy(recent, (r2) => r2.testId)
      .filter((s) => s.avgDurationMs)
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, 3);
    const slowRows = slowest.map((s) => {
      const t = testById.get(s.key);
      return `<li><span>🐢 ${escapeHtml(t ? t.name : tt(`teste #${s.key}`, `test #${s.key}`))}</span><span class="insight-why">${fmtDuration(s.avgDurationMs)} ${tt('em média', 'on average')} · ${s.total} ${tt('execução(ões)', 'run(s)')}</span></li>`;
    }).join('');

    const flakyRows = [...flaky.entries()]
      .sort((a, b) => b[1].failRate - a[1].failRate)
      .slice(0, 5)
      .map(([id, info]) => {
        const t = testById.get(id);
        return `<li><span>⚡ ${escapeHtml(t ? t.name : tt(`teste #${id}`, `test #${id}`))}</span><span class="insight-why">${info.fails} ${tt('falha(s) em', 'failure(s) in')} ${info.total} ${tt('execuções', 'runs')}</span></li>`;
      }).join('');

    const priorityRows = priority.map((s) =>
      `<li><span>${escapeHtml(s.name)}${s.suite ? ` <span class="insight-why">· ${escapeHtml(s.suite)}</span>` : ''}</span><span class="insight-why">${escapeHtml(s.reasons.join(' · '))}</span></li>`
    ).join('');

    el.innerHTML = `
      <div class="metrics-actions"><button id="execReportBtn" class="btn-secondary">${tt('⬇ Relatório executivo (HTML)', '⬇ Executive report (HTML)')}</button></div>
      ${heroHtml}
      <div class="metrics-cards">
        ${donutHtml}
        ${card('🧪', m.total, tt('execuções (30 dias)', 'runs (30 days)'))}
        ${card('⏱', fmtDuration(m.avgDurationMs), tt('duração média', 'average duration'))}
        ${card('⚡', flaky.size, tt('testes instáveis', 'flaky tests'), flaky.size > 0 ? 'warn' : 'ok')}
        ${card('🗂', `${neverRun}/${tests.length}`, tt('salvos nunca executados', 'saved but never run'))}
      </div>

      <section class="card card-wide">
        <h2>${tt('📊 Últimos 14 dias', '📊 Last 14 days')}</h2>
        <div class="mx-chart">${trendHtml}</div>
      </section>

      <div class="mx-grid-2">
        <section class="card">
          <h2>${tt('🗂 Aprovação por suite (30d)', '🗂 Pass rate by suite (30d)')}</h2>
          ${suiteRows ? `<table class="mx-table"><tr><th>${tt('Suite', 'Suite')}</th><th>${tt('Exec.', 'Runs')}</th><th>${tt('Aprovação', 'Pass rate')}</th><th>${tt('Duração', 'Duration')}</th></tr>${suiteRows}</table>` : `<p class="metrics-empty">${tt('Sem execuções de testes salvos no período.', 'No saved-test runs in this period.')}</p>`}
        </section>
        <section class="card">
          <h2>${tt('🌍 Aprovação por ambiente (30d)', '🌍 Pass rate by environment (30d)')}</h2>
          ${envRows ? `<table class="mx-table"><tr><th>${tt('Ambiente', 'Environment')}</th><th>${tt('Exec.', 'Runs')}</th><th>${tt('Aprovação', 'Pass rate')}</th><th>${tt('Duração', 'Duration')}</th></tr>${envRows}</table>` : `<p class="metrics-empty">${tt('Nenhuma execução com ambiente selecionado — escolha um ambiente na aba Executar para comparar aqui.', 'No runs with a selected environment — pick one in the Run tab to compare here.')}</p>`}
        </section>
      </div>

      <div class="mx-grid-2">
        <section class="card">
          <h2>${tt('⚡ Testes instáveis (flaky)', '⚡ Flaky tests')}</h2>
          ${flakyRows ? `<ul class="insight-list">${flakyRows}</ul>` : `<p class="metrics-empty">${tt('Nenhum teste com resultados inconsistentes. 🎉', 'No tests with inconsistent results. 🎉')}</p>`}
          <p class="form-hint" style="margin-top:8px">${tt('Confirme com repetição 3×/5× no lote.', 'Confirm with 3×/5× repetition in a batch.')}</p>
        </section>
        <section class="card">
          <h2>${tt('🐢 Mais lentos (30d)', '🐢 Slowest (30d)')}</h2>
          ${slowRows ? `<ul class="insight-list">${slowRows}</ul>` : `<p class="metrics-empty">${tt('Sem dados de duração ainda.', 'No duration data yet.')}</p>`}
        </section>
      </div>

      <section class="card card-wide">
        <h2>${tt('🎯 O que testar primeiro', '🎯 What to test first')}</h2>
        ${priorityRows ? `<ul class="insight-list">${priorityRows}</ul>` : `<p class="metrics-empty">${tt('Tudo em dia — nenhum teste pendente de atenção.', 'All caught up — no tests pending attention.')}</p>`}
      </section>`;

    el.querySelector('#execReportBtn')?.addEventListener('click', () =>
      downloadExecutiveReport({ m, trend, flaky, priority, testById, neverRun, totalTests: tests.length, suites, envs })
    );
  });
}

function downloadExecutiveReport({ m, trend, flaky, priority, testById, neverRun, totalTests, suites = [], envs = [] }) {
  const flakyRows = [...flaky.entries()]
    .sort((a, b) => b[1].failRate - a[1].failRate)
    .map(([id, info]) => {
      const t = testById.get(id);
      return `<tr><td>⚡ ${escapeHtml(t ? t.name : `teste #${id}`)}</td><td>${info.fails} falha(s) em ${info.total}</td></tr>`;
    }).join('');
  const prioRows = priority.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.reasons.join(' · '))}</td></tr>`).join('');
  const trendRows = trend.map((d) => `<tr><td>${d.day}</td><td>${d.passed}</td><td>${d.failed}</td><td>${d.other}</td></tr>`).join('');

  const html = `<!DOCTYPE html><html lang="${tt('pt-BR', 'en')}"><head><meta charset="UTF-8"><title>${tt('Bia — Relatório Executivo', 'Bia — Executive Report')}</title>
<style>body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#111;font-size:13px;line-height:1.55}
h1{font-size:20px}h2{font-size:15px;margin-top:22px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
.c{border:1px solid #d1d5db;border-radius:10px;padding:12px 16px;min-width:130px}
.c b{font-size:22px;display:block}.c span{font-size:11px;color:#6b7280}
table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}td,th{border:1px solid #d1d5db;padding:5px 8px;text-align:left}
</style></head><body>
<h1>${tt('Bia — Relatório Executivo de Qualidade', 'Bia — Executive Quality Report')}</h1>
<p>${tt('Gerado em', 'Generated on')} ${escapeHtml(new Date().toLocaleString(dateLocale()))} · ${tt('janela de 30 dias', '30-day window')}</p>
<div class="cards">
  <div class="c"><b>${m.total}</b><span>${tt('execuções', 'runs')}</span></div>
  <div class="c"><b>${m.passRate === null ? '—' : Math.round(m.passRate * 100) + '%'}</b><span>${tt('taxa de aprovação', 'pass rate')}</span></div>
  <div class="c"><b>${fmtDuration(m.avgDurationMs)}</b><span>${tt('duração média', 'average duration')}</span></div>
  <div class="c"><b>${flaky.size}</b><span>${tt('testes instáveis', 'flaky tests')}</span></div>
  <div class="c"><b>${neverRun}/${totalTests}</b><span>${tt('salvos nunca executados', 'saved but never run')}</span></div>
</div>
<h2>${tt('Aprovação por suite (30 dias)', 'Pass rate by suite (30 days)')}</h2>
${suites.length ? `<table><tr><th>${tt('Suite', 'Suite')}</th><th>${tt('Execuções', 'Runs')}</th><th>${tt('Aprovação', 'Pass rate')}</th></tr>${suites.slice(0, 10).map((s) => `<tr><td>${escapeHtml(String(s.key))}</td><td>${s.total}</td><td>${s.passRate === null ? '—' : Math.round(s.passRate * 100) + '%'}</td></tr>`).join('')}</table>` : `<p>${tt('Sem dados.', 'No data.')}</p>`}
${envs.length ? `<h2>${tt('Aprovação por ambiente (30 dias)', 'Pass rate by environment (30 days)')}</h2><table><tr><th>${tt('Ambiente', 'Environment')}</th><th>${tt('Execuções', 'Runs')}</th><th>${tt('Aprovação', 'Pass rate')}</th></tr>${envs.slice(0, 10).map((e) => `<tr><td>${escapeHtml(String(e.key))}</td><td>${e.total}</td><td>${e.passRate === null ? '—' : Math.round(e.passRate * 100) + '%'}</td></tr>`).join('')}</table>` : ''}
<h2>${tt('Tendência — últimos 14 dias', 'Trend — last 14 days')}</h2>
<table><tr><th>${tt('Dia', 'Day')}</th><th>✅ ${tt('Aprovados', 'Passed')}</th><th>❌ ${tt('Reprovados', 'Failed')}</th><th>⚠️ ${tt('Outros', 'Other')}</th></tr>${trendRows}</table>
<h2>${tt('Testes instáveis (flaky)', 'Flaky tests')}</h2>
${flakyRows ? `<table><tr><th>${tt('Teste', 'Test')}</th><th>${tt('Instabilidade', 'Instability')}</th></tr>${flakyRows}</table>` : `<p>${tt('Nenhum teste instável no período. 🎉', 'No flaky tests in this period. 🎉')}</p>`}
<h2>${tt('Prioridades de teste', 'Test priorities')}</h2>
${prioRows ? `<table><tr><th>${tt('Teste', 'Test')}</th><th>${tt('Motivo', 'Reason')}</th></tr>${prioRows}</table>` : `<p>${tt('Nenhuma pendência.', 'Nothing pending.')}</p>`}
<hr><p style="color:#6b7280;font-size:11px">${tt('Relatório gerado pela Bia', 'Report generated by Bia')}</p>
</body></html>`;

  saveDashDownload(new Blob([html], { type: 'text/html' }), `flow-qa-relatorio-executivo-${new Date().toISOString().slice(0, 10)}.html`);
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MANUAL_EN = `
<section>
  <h2>💬 Chat with Bia</h2>
  <p>The <b>Chat</b> tab is the main interface. Ask anything in natural language — Bia acts on the <b>active tab</b> (clicks, types, navigates, even across sites) and replies in the conversation. Follow-ups keep the context; use <b>+</b> for a new conversation and <b>🕘</b> to reopen saved ones.</p>
  <p>Two dropdowns sit in the composer, next to <b>+</b> and <b>🕘</b>:</p>
  <ul>
    <li><b>Mode</b> — <b>Agent</b> acts on the page (the default behaviour); <b>Chat</b> only reads and answers, never clicking or typing; <b>Translator</b> auto-detects the language and returns just the translation (Portuguese in, English out — and the other way round).</li>
    <li><b>Model</b> — picks the model for the chat only, without touching the model used by the Run tab. Haiku 4.5 is the cheap everyday option; switch to Sonnet 5 for heavy work. GPT and Gemini go through the proxy's OpenAI-compatible API and are experimental with agent tools.</li>
  </ul>
  <p>In Chat and Agent modes Bia can also inspect what DevTools shows: storage, cookies (including HttpOnly), request/response headers and response bodies. Token and JWT values always arrive masked, with the claims decoded (issuer, expiry, roles); revealing a raw value asks for your confirmation first and warns that the value will be sent to the AI gateway. Turn the whole thing off in <b>Features → DevTools inspection in chat</b>.</p>
  <p class="tip">👤 <b>Accessible mode</b>: replies are read aloud and the 🎤 button lets you dictate commands — built for visually impaired users.</p>
</section>
<section>
  <h2>▶️ Run a test</h2>
  <p>Write the test case in natural language or numbered steps in the panel's <b>Run</b> tab and click <b>Run Test</b> (or <code>Ctrl/Cmd+Enter</code>). The agent drives the real browser: clicks, types, navigates and validates — you follow every step live.</p>
  <ul>
    <li>Accepted formats: free text ("Log in and check the dashboard") or BDD (<code>Given/When/Then</code>).</li>
    <li>Every "Check that..." becomes a real assertion (text, URL, attribute or API request).</li>
    <li>The final verdict is structured: ✅ Passed, ❌ Failed or ⚠️ Blocked/Inconclusive.</li>
    <li>Sensitive actions (delete, pay, logout...) pause and ask for your confirmation in the panel.</li>
  </ul>
  <p class="tip">💡 The cycle limit per run (default 25) is adjustable in Settings → Agent.</p>
</section>
<section>
  <h2>🔴 Action recorder</h2>
  <p>Click <b>Record</b>, use the page normally (clicks, typing, selections, Enter, navigation) and then <b>Stop and generate</b>: the extension turns your actions into a numbered, readable test case anchored on texts and labels — not brittle selectors. Review, complete the expected result and save.</p>
  <p class="tip">🔒 Passwords are never recorded — they become <code>{{senha}}</code>, defined in Environments.</p>
</section>
<section>
  <h2>📚 Library, tags and suites</h2>
  <p>After a run, <b>Save Test</b> stores the test case with <b>tags</b> (comma-separated) and a <b>suite</b>. In the <b>Tests</b> tab, search covers name, tag and suite, and items are grouped by suite.</p>
  <ul>
    <li>▶ on an item: opens the test in the Run tab (without running) for review.</li>
    <li>Checkbox: selects it for batch execution.</li>
    <li>Here in the Dashboard: export/import the library as JSON to share with your team.</li>
  </ul>
</section>
<section>
  <h2>📦 Batch execution</h2>
  <p>Select tests with the checkboxes and click <b>Run selected</b>, or use <b>▶ Run suite</b> on a group header. Tests run in sequence in the same tab with live progress; at the end you get a summary (✅/❌/⚠️ per test) with each full report expandable.</p>
</section>
<section>
  <h2>🧮 Data-driven (Data)</h2>
  <p>Use <code>{{field}}</code> in the test case and fill the <b>Data</b> field with a JSON array — the test runs once per row:</p>
  <p><code>[{"email": "a@x.com", "senha": "123"}, {"email": "b@x.com", "senha": "456"}]</code></p>
</section>
<section>
  <h2>🌍 Environments</h2>
  <p>In Settings → Environments, define a JSON with variables per environment (<code>staging</code>, <code>prod</code>...). In the panel, the selector next to the Record button picks the active environment — the test case's <code>{{variables}}</code> are filled at run time. A variable without a value blocks the run with a warning.</p>
</section>
<section>
  <h2>🌐 API assertions (network)</h2>
  <p>The extension intercepts the page's fetch/XHR in real time. In a test case you can ask, for example: <i>"Check that the /api/users request returned status 200"</i> — the agent uses the <code>assert_network_request</code> and <code>get_network_requests</code> tools. The <b>Debug</b> tab also lists recent calls.</p>
</section>
<section>
  <h2>🐛 Jira and 🔄 Zephyr</h2>
  <p><b>Jira:</b> with URL, token and project key configured, the <b>Create Jira Bug</b> button appears on results — the bug ships with steps, environment and the screenshot attached.</p>
  <p><b>Zephyr Scale:</b> import a test case by key (e.g. <code>PROJ-T123</code>) here in the Dashboard — the steps become an executable test in the library ("Zephyr" suite). When you run it, the result gets a <b>Send to Zephyr</b> button that records the Test Execution (Pass/Fail/Blocked) in the chosen cycle.</p>
</section>
<section>
  <h2>🔍 Debug and Inspector</h2>
  <p><b>Debug:</b> an x-ray of the current page — security (HTTPS, mixed content, CSRF), accessibility (basic WCAG), performance, tokens/JWT in storage, network calls and JS errors. Exportable as Markdown.</p>
  <p><b>Inspector:</b> click any element on the page to see the best selector, XPath, role and attributes — useful for writing precise steps.</p>
</section>
<section>
  <h2>📄 Reports and PDF</h2>
  <p>Every result includes the agent's full report (status, steps, expected × observed, bugs, evidence). The <b>PDF</b> button opens the print view — use <code>Ctrl/Cmd+P</code> → "Save as PDF". For batches, the PDF consolidates the summary plus every report.</p>
</section>
<section>
  <h2>🎬 Execution video and visual regression</h2>
  <p><b>Video:</b> with the feature on, each single run produces a .webm video (CDP screencast assembled in the panel) — available on the result under "🎬 Execution video", with download. Requires the panel to stay open during the run; batches don't record video.</p>
  <p><b>Visual regression:</b> for saved tests, set a <b>baseline</b> on a run result. On later runs Bia captures the final screen, compares pixel by pixel and shows the <b>Δ%</b> with differences highlighted in red — update the baseline when the change is intentional.</p>
  <p><b>Where files are saved:</b> in Settings → Agent you can set a subfolder inside Downloads (e.g. <code>flow-qa</code>) for videos and screenshots, or check "Ask where to save" to pick any folder via Chrome's picker on each download. For security, Chrome can't write outside Downloads without that picker.</p>
  <p><b>Accessibility (axe-core):</b> ask for it in the test case — e.g. <i>"run an accessibility audit and report the violations"</i> — and the agent uses the built-in <code>accessibility_audit</code> tool, returning WCAG violations by impact.</p>
</section>
<section>
  <h2>📈 Metrics, flaky tests and prioritization</h2>
  <p>Every run (single or batch) feeds the history. In the <b>Metrics</b> tab you see the pass rate, the last-14-days trend, average duration, <b>flaky tests</b> — the ones alternating ✅/❌ across recent runs (also marked with ⚡ in the library) — and <b>what to test first</b>, prioritized by risk (never run, last run failed, unstable, idle for days).</p>
  <p class="tip">💡 To confirm a flaky: select the test in the library and run it with <b>3×</b> or <b>5×</b> repetition. To compare environments, check <b>environments</b> in the batch — each test runs in every configured environment.</p>
</section>
<section>
  <h2>💡 Test case suggestions (assisted exploratory)</h2>
  <p>In the Tests tab, the <b>💡 Suggest</b> button asks the AI to analyze the current page (elements + content) and propose 3–5 ready-made test cases. Review, select and save — they join the "Exploratório" suite.</p>
</section>
<section>
  <h2>🚀 Scale: parallel, profiles, templates and exports</h2>
  <ul>
    <li><b>Parallel execution:</b> in a batch, choose "2 tabs" or "3 tabs" — each test runs in its own tab (opened from the current page) and tabs close by themselves. Use sequential when a test depends on the state left by the previous one.</li>
    <li><b>Quick profiles:</b> in Features, apply presets by role — Full QA, Dev (run + debug), Generic (minimal assistant) or Chat Only (Bia).</li>
    <li><b>Templates:</b> ready-made test cases by vertical (e-commerce, SaaS, institutional) using {{variables}} — add to the library and adjust.</li>
    <li><b>Exports:</b> batch results as <code>JSON</code> (for pipelines/CI to consume as an artifact) and the executive HTML report in the Metrics tab (for managers, no extension needed).</li>
  </ul>
  <p class="tip">⚠️ In parallel mode, sensitive-action confirmations from simultaneous runs appear one at a time in the panel — prefer tests without sensitive actions when parallelizing.</p>
</section>
<section>
  <h2>🛡️ Security and privacy</h2>
  <ul>
    <li>API keys and tokens live only in <code>chrome.storage.local</code> — never synced.</li>
    <li>Sensitive data (valid cards, CPF/CNPJ, JWT, emails) is masked before reaching the model.</li>
    <li>Destructive actions are blocked without explicit instruction; sensitive actions require confirmation.</li>
    <li>Page content is treated as data, never as instruction (anti prompt-injection).</li>
    <li>For highly sensitive environments, turn off <b>Agent vision</b> in Features — no screenshots are sent to the model.</li>
  </ul>
</section>`;

function renderManual() {
  if (uiLang === 'en') {
    $('manualContent').innerHTML = MANUAL_EN;
    return;
  }
  $('manualContent').innerHTML = `
<section>
  <h2>💬 Conversar com a Bia</h2>
  <p>A aba <b>Chat</b> é a interface principal. Peça em linguagem natural — a Bia age na <b>aba ativa</b> (clica, digita, navega, inclusive entre sites) e responde na conversa. As mensagens seguintes mantêm o contexto; use <b>+</b> para uma conversa nova e <b>🕘</b> para reabrir as salvas.</p>
  <p>Dois seletores ficam na barra do composer, junto do <b>+</b> e do <b>🕘</b>:</p>
  <ul>
    <li><b>Modo</b> — <b>Agente</b> age na página (o comportamento de sempre); <b>Chat</b> apenas lê e responde, sem clicar nem digitar; <b>Tradutor</b> detecta o idioma sozinho e devolve só a tradução (escreveu em português, sai em inglês — e vice-versa).</li>
    <li><b>Modelo</b> — escolhe o modelo só do chat, sem mexer no que a aba Executar usa. Haiku 4.5 é o barato para o dia a dia; troque para Sonnet 5 quando a tarefa for pesada. GPT e Gemini entram pela API compatível com OpenAI do proxy e são experimentais com as ferramentas do agente.</li>
  </ul>
  <p>Nos modos Chat e Agente a Bia também enxerga o que o DevTools mostra: storage, cookies (inclusive HttpOnly), headers de requisição e resposta e o corpo das respostas. Valores de token e JWT chegam sempre mascarados, com as claims decodificadas (emissor, expiração, papéis); revelar um valor cru pede sua confirmação e avisa que ele será enviado ao gateway de IA. Para tirar esse acesso por completo, desligue em <b>Funcionalidades → Inspeção DevTools no chat</b>.</p>
  <p class="tip">👤 <b>Modo acessível</b>: as respostas são lidas em voz alta e o botão 🎤 permite ditar comandos — feito para pessoas com deficiência visual.</p>
</section>
<section>
  <h2>▶️ Executar um teste</h2>
  <p>Escreva o test case em linguagem natural ou em steps numerados na aba <b>Executar</b> do painel lateral e clique em <b>Executar Teste</b> (ou <code>Ctrl/Cmd+Enter</code>). O agente controla o navegador de verdade: clica, digita, navega e valida — você acompanha cada passo ao vivo.</p>
  <ul>
    <li>Formatos aceitos: texto livre ("Faça login e verifique o dashboard") ou BDD (<code>Given/When/Then</code> · <code>Dado/Quando/Então</code>).</li>
    <li>Cada "Verifique que..." vira uma assertion real (texto, URL, atributo ou requisição de API).</li>
    <li>O veredito final é estruturado: ✅ Aprovado, ❌ Reprovado ou ⚠️ Bloqueado/Inconclusivo.</li>
    <li>Ações sensíveis (excluir, pagar, logout...) pausam e pedem sua confirmação no painel.</li>
  </ul>
  <p class="tip">💡 O limite de ciclos por execução (padrão 25) é ajustável em Configurações → Agente.</p>
</section>
<section>
  <h2>🔴 Gravador de ações</h2>
  <p>Clique em <b>Gravar</b>, use a página normalmente (cliques, digitação, seleções, Enter, navegação) e depois em <b>Parar e gerar</b>: a extensão transforma suas ações em um test case numerado e legível, ancorado em textos e rótulos — não em seletores frágeis. Revise, complete o resultado esperado e salve.</p>
  <p class="tip">🔒 Senhas nunca são gravadas — viram <code>{{senha}}</code>, que você define em Ambientes.</p>
</section>
<section>
  <h2>📚 Biblioteca, tags e suites</h2>
  <p>Após uma execução, <b>Salvar Teste</b> guarda o test case com <b>tags</b> (separadas por vírgula) e <b>suite</b>. Na aba <b>Testes</b>, a busca cobre nome, tag e suite, e os itens ficam agrupados por suite.</p>
  <ul>
    <li>▶ no item: abre o teste na aba Executar (sem rodar) para revisar.</li>
    <li>Checkbox: seleciona para execução em lote.</li>
    <li>Aqui no Dashboard: exporte/importe a biblioteca em JSON para compartilhar com o time.</li>
  </ul>
</section>
<section>
  <h2>📦 Execução em lote</h2>
  <p>Selecione testes com os checkboxes e clique em <b>Executar selecionados</b>, ou use <b>▶ Executar suite</b> no cabeçalho do grupo. Os testes rodam em sequência na mesma aba, com progresso ao vivo; ao final você vê o resumo (✅/❌/⚠️ por teste) com o relatório completo expansível.</p>
</section>
<section>
  <h2>🧮 Data-driven (Dados)</h2>
  <p>Use <code>{{campo}}</code> no test case e preencha o campo <b>Dados</b> com um array JSON — o teste roda uma vez por linha:</p>
  <p><code>[{"email": "a@x.com", "senha": "123"}, {"email": "b@x.com", "senha": "456"}]</code></p>
</section>
<section>
  <h2>🌍 Ambientes</h2>
  <p>Defina em Configurações → Ambientes um JSON com variáveis por ambiente (<code>staging</code>, <code>prod</code>...). No painel, o seletor ao lado do botão Gravar escolhe o ambiente ativo — as <code>{{variáveis}}</code> do test case são preenchidas na execução. Variável sem valor bloqueia a execução com aviso.</p>
</section>
<section>
  <h2>🌐 Assertions de API (rede)</h2>
  <p>A extensão intercepta fetch/XHR da página em tempo real. No test case você pode pedir, por exemplo: <i>"Verifique que a requisição /api/users retornou status 200"</i> — o agente usa as ferramentas <code>assert_network_request</code> e <code>get_network_requests</code>. A aba <b>Debug</b> também lista as chamadas recentes.</p>
</section>
<section>
  <h2>🐛 Jira e 🔄 Zephyr</h2>
  <p><b>Jira:</b> com URL, token e project key configurados, o botão <b>Criar Bug no Jira</b> aparece nos resultados — o bug vai com steps, ambiente e screenshot anexada.</p>
  <p><b>Zephyr Scale:</b> importe um test case pela chave (ex.: <code>PROJ-T123</code>) aqui no Dashboard — os steps viram um teste executável na biblioteca (suite "Zephyr"). Ao executá-lo, o resultado ganha o botão <b>Enviar ao Zephyr</b>, que registra a Test Execution (Pass/Fail/Blocked) no ciclo escolhido.</p>
</section>
<section>
  <h2>🔍 Debug e Inspetor</h2>
  <p><b>Debug:</b> raio-x da página atual — segurança (HTTPS, mixed content, CSRF), acessibilidade (WCAG básico), performance, tokens/JWT no storage, chamadas de rede e erros JS. Exportável em Markdown.</p>
  <p><b>Inspetor:</b> clique em qualquer elemento da página para ver o melhor seletor, XPath, role e atributos — útil para escrever steps precisos.</p>
</section>
<section>
  <h2>📄 Relatórios e PDF</h2>
  <p>Todo resultado tem o relatório completo do agente (status, passos, esperado × observado, bugs, evidências). O botão <b>PDF</b> abre a versão de impressão — use <code>Ctrl/Cmd+P</code> → "Salvar como PDF". No lote, o PDF consolida o resumo + todos os relatórios.</p>
</section>
<section>
  <h2>🎬 Vídeo da execução e regressão visual</h2>
  <p><b>Vídeo:</b> com a funcionalidade ligada, cada execução única gera um vídeo .webm (screencast via CDP montado no painel) — disponível no resultado em "🎬 Vídeo da execução", com download. Requer o painel aberto durante a execução; lotes não geram vídeo.</p>
  <p><b>Regressão visual:</b> para testes salvos na biblioteca, defina um <b>baseline</b> no resultado da execução. Nas próximas execuções a Bia captura a tela final, compara pixel a pixel e mostra <b>Δ%</b> com as diferenças destacadas em vermelho — atualize o baseline quando a mudança for intencional.</p>
  <p><b>Onde salvar:</b> em Configurações → Agente você define uma subpasta dentro de Downloads (ex.: <code>flow-qa</code>) para vídeos e prints, ou marca "Perguntar onde salvar" para escolher qualquer pasta pelo seletor do Chrome a cada download. Por segurança, o Chrome não permite gravar fora de Downloads sem esse seletor.</p>
  <p><b>Acessibilidade (axe-core):</b> peça no test case — ex.: <i>"rode uma auditoria de acessibilidade e reporte as violações"</i> — e o agente usa a ferramenta <code>accessibility_audit</code> (axe-core embutido) retornando violações WCAG por impacto.</p>
</section>
<section>
  <h2>📈 Métricas, flaky tests e priorização</h2>
  <p>Cada execução (única ou em lote) alimenta o histórico. Na aba <b>Métricas</b> você vê taxa de aprovação, tendência dos últimos 14 dias, duração média, <b>testes instáveis (flaky)</b> — os que alternam ✅/❌ nas execuções recentes (também marcados com ⚡ na biblioteca) — e <b>o que testar primeiro</b>, priorizado por risco (nunca executado, última falhou, instável, parado há dias).</p>
  <p class="tip">💡 Para confirmar um flaky: selecione o teste na biblioteca e rode com repetição <b>3×</b> ou <b>5×</b>. Para comparar ambientes, marque <b>ambientes</b> no lote — cada teste roda em todos os ambientes configurados.</p>
</section>
<section>
  <h2>💡 Sugestão de test cases (exploratório assistido)</h2>
  <p>Na aba Testes, o botão <b>💡 Sugerir</b> pede à IA que analise a página atual (elementos + conteúdo) e proponha de 3 a 5 test cases prontos. Revise, selecione e salve — eles entram na suite "Exploratório".</p>
</section>
<section>
  <h2>🚀 Escala: paralelo, perfis, templates e exports</h2>
  <ul>
    <li><b>Execução paralela:</b> no lote, escolha "2 abas" ou "3 abas" — cada teste roda numa aba própria (aberta a partir da página atual) e as abas fecham sozinhas ao terminar. Use sequencial quando um teste depende do estado deixado pelo anterior.</li>
    <li><b>Perfis rápidos:</b> em Funcionalidades, aplique presets por papel — QA completo, Dev (executar + debugar) ou Genérico (assistente mínimo).</li>
    <li><b>Templates:</b> test cases prontos por vertical (e-commerce, SaaS, institucional) usando {{variáveis}} — adicione à biblioteca e ajuste.</li>
    <li><b>Exports:</b> resultado do lote em <code>JSON</code> (para pipelines/CI consumirem como artefato) e relatório executivo em HTML na aba Métricas (para gestores, sem precisar da extensão).</li>
  </ul>
  <p class="tip">⚠️ No modo paralelo, confirmações de ações sensíveis de execuções simultâneas aparecem uma por vez no painel — prefira testes sem ações sensíveis ao paralelizar.</p>
</section>
<section>
  <h2>🛡️ Segurança e privacidade</h2>
  <ul>
    <li>API keys e tokens ficam só no <code>chrome.storage.local</code> — nunca são sincronizados.</li>
    <li>Dados sensíveis (cartões válidos, CPF/CNPJ, JWT, e-mails) são mascarados antes de ir ao modelo.</li>
    <li>Ações destrutivas são bloqueadas sem instrução explícita; ações sensíveis pedem confirmação.</li>
    <li>Conteúdo da página é tratado como dado, nunca como instrução (anti prompt-injection).</li>
    <li>Para ambientes muito sensíveis, desligue a <b>Visão do agente</b> em Funcionalidades — nenhuma screenshot é enviada ao modelo.</li>
  </ul>
</section>`;
}

function applyTheme() {
  isDarkMode = themeMode === 'system' ? systemDarkQuery.matches : themeMode === 'dark';
  document.body.classList.toggle('dark', isDarkMode);
  const btn = $('darkToggleBtn');
  btn.textContent = themeMode === 'system' ? '🖥️' : isDarkMode ? '☀️' : '🌙';
  btn.title = themeMode === 'system'
    ? tt('Tema: seguindo o sistema (clique para alternar)', 'Theme: following the system (click to toggle)')
    : tt(`Tema: ${isDarkMode ? 'escuro' : 'claro'} (clique para alternar)`, `Theme: ${isDarkMode ? 'dark' : 'light'} (click to toggle)`);
}

let statusMsgTimer = null;
function showStatus(msg, type) {
  const el = $('statusMsg');
  clearTimeout(statusMsgTimer);
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  statusMsgTimer = setTimeout(() => { el.textContent = ''; el.className = 'status-msg'; }, 4000);
}

function loadAll() {
  chrome.storage.local.get([...Object.keys(FIELDS), 'maxSteps', 'videoAutoSave', 'featureFlags', 'downloadFolder', 'downloadAskWhere'], (r) => {
    $('videoAutoSave').checked = r.videoAutoSave === true;
    $('downloadFolder').value = r.downloadFolder || '';
    $('downloadAskWhere').checked = r.downloadAskWhere === true;
    syncVideoEnabled(r.featureFlags || {});
    for (const [key, id] of Object.entries(FIELDS)) {
      $(id).value = r[key] || '';
    }
    $('maxStepsInput').value = clampMaxSteps(r.maxSteps ?? DEFAULT_MAX_STEPS);
    $('modelModeSelect').value = (r.featureFlags || {}).modelMode || 'sonnet';
  });
}

function saveAll() {
  const apiKey = $(FIELDS.apiKey).value.trim();

  const envParsed = parseEnvironments($(FIELDS.environmentsJson).value);
  if (envParsed.error) { showStatus(`${tt('Ambientes', 'Environments')}: ${envParsed.error}`, 'error'); return; }

  const gatewayUrl = $(FIELDS.gatewayUrl).value.trim().replace(/\/$/, '');
  const jiraUrl = $(FIELDS.jiraUrl).value.trim().replace(/\/$/, '');
  const zephyrBaseUrl = $(FIELDS.zephyrBaseUrl).value.trim().replace(/\/$/, '');
  for (const [label, url] of [['Gateway URL', gatewayUrl], ['Jira URL', jiraUrl], ['Zephyr Base URL', zephyrBaseUrl]]) {
    if (!looksLikeUrl(url)) { showStatus(tt(`${label} inválida — use uma URL completa (ex.: https://...)`, `Invalid ${label} — use a full URL (e.g. https://...)`), 'error'); return; }
  }

  chrome.storage.local.set({
    apiKey,
    gatewayUrl,
    maxSteps: clampMaxSteps($('maxStepsInput').value),
    environmentsJson: $(FIELDS.environmentsJson).value.trim(),
    jiraUrl,
    jiraEmail: $(FIELDS.jiraEmail).value.trim(),
    jiraToken: $(FIELDS.jiraToken).value.trim(),
    jiraProjectKey: $(FIELDS.jiraProjectKey).value.trim().toUpperCase(),
    zephyrBaseUrl,
    zephyrToken: $(FIELDS.zephyrToken).value.trim(),
    zephyrProjectKey: $(FIELDS.zephyrProjectKey).value.trim().toUpperCase(),
  }, () => {
    if (chrome.runtime.lastError) { showStatus(tt(`Erro ao salvar: ${chrome.runtime.lastError.message}`, `Error saving: ${chrome.runtime.lastError.message}`), 'error'); return; }
    showStatus(apiKey
      ? tt('✓ Configurações salvas', '✓ Settings saved')
      : tt('✓ Salvo — insira a API Key para poder executar testes', '✓ Saved — enter the API Key to run tests'), 'success');
  });
}

function refreshLibraryStats() {
  chrome.storage.local.get(['savedTests'], (r) => {
    const tests = r.savedTests || [];
    const suites = new Set(tests.map((t) => t.suite).filter(Boolean));
    const zephyr = tests.filter((t) => t.zephyrKey).length;
    $('libraryStats').textContent = tests.length === 0
      ? tt('Nenhum teste salvo ainda.', 'No saved tests yet.')
      : `${tests.length} ${tt('teste(s)', 'test(s)')} · ${suites.size} ${tt('suite(s)', 'suite(s)')}${zephyr ? ` · ${zephyr} ${tt('vindo(s) do Zephyr', 'from Zephyr')}` : ''}`;
  });
}

function sendMsg(action, params = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...params }, (r) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(r || { error: 'Sem resposta do service worker' });
    });
  });
}

function renderZephyrExportSelect() {
  chrome.storage.local.get(['savedTests'], (r) => {
    const tests = (r.savedTests || []).filter((t) => !t.zephyrKey);
    const sel = $('zephyrExportSelect');
    sel.innerHTML = `<option value="">${tt('Selecione um teste…', 'Select a test…')}</option>` +
      tests.map((t) => `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.name)}</option>`).join('');
  });
}

function currentZephyrConfig() {
  return {
    zephyrToken: $(FIELDS.zephyrToken).value.trim(),
    zephyrProjectKey: $(FIELDS.zephyrProjectKey).value.trim(),
    zephyrBaseUrl: $(FIELDS.zephyrBaseUrl).value.trim().replace(/\/$/, ''),
  };
}

async function exportToZephyr() {
  const sel = $('zephyrExportSelect');
  const status = $('zephyrExportStatus');
  const testId = Number(sel.value);
  if (!testId) { status.textContent = tt('Selecione um teste da biblioteca.', 'Select a test from the library.'); return; }
  const cfg = currentZephyrConfig();
  if (!cfg.zephyrToken || !cfg.zephyrProjectKey) {
    status.textContent = tt('⚠️ Preencha o API Token e a Project Key do Zephyr primeiro.', '⚠️ Fill in the Zephyr API Token and Project Key first.');
    return;
  }
  await new Promise((r) => chrome.storage.local.set(cfg, r));
  status.textContent = tt('Exportando...', 'Exporting...');
  const res = await sendMsg('zephyrExport', { testId });
  if (res.error) { status.textContent = `⚠️ ${res.error}`; return; }
  status.textContent = tt(`✓ Exportado como ${res.key} — o teste local ficou vinculado a essa chave.`, `✓ Exported as ${res.key} — the local test is now linked to that key.`);
  renderZephyrExportSelect();
  refreshLibraryStats();
}

async function importFromZephyr() {
  const key = $('zephyrImportKey').value.trim().toUpperCase();
  const status = $('zephyrImportStatus');
  if (!key) { status.textContent = tt('Informe a chave do test case (ex.: PROJ-T123).', 'Enter the test case key (e.g. PROJ-T123).'); return; }

  const cfg = currentZephyrConfig();
  if (!cfg.zephyrToken || !cfg.zephyrProjectKey) { status.textContent = tt('⚠️ Preencha o API Token e a Project Key do Zephyr primeiro.', '⚠️ Fill in the Zephyr API Token and Project Key first.'); return; }
  await new Promise((r) => chrome.storage.local.set(cfg, r));

  status.textContent = tt('Importando...', 'Importing...');
  const res = await sendMsg('zephyrImport', { key });
  if (res.error) { status.textContent = `⚠️ ${res.error}`; return; }

  chrome.storage.local.get(['savedTests'], (r) => {
    const tests = r.savedTests || [];
    const existing = tests.find((t) => t.zephyrKey === res.key);
    if (existing) {
      existing.name = `${res.key} — ${res.name}`;
      existing.prompt = res.prompt;
      existing.savedAt = new Date().toLocaleString('pt-BR');
    } else {
      tests.unshift({
        id: Date.now(),
        name: `${res.key} — ${res.name}`,
        prompt: res.prompt,
        savedAt: new Date().toLocaleString('pt-BR'),
        tags: ['zephyr'],
        suite: 'Zephyr',
        zephyrKey: res.key,
      });
    }
    chrome.storage.local.set({ savedTests: tests }, () => {
      status.textContent = tt(`✓ ${res.key} ${existing ? 'atualizado' : 'importado'} para a biblioteca.`, `✓ ${res.key} ${existing ? 'updated' : 'imported'} into the library.`);
      $('zephyrImportKey').value = '';
      refreshLibraryStats();
    });
  });
}

function saveDashDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.storage.local.get(['downloadFolder', 'downloadAskWhere'], (r) => {
    const folder = sanitizePathSegment(r.downloadFolder);
    const full = folder ? `${folder}/${filename}` : filename;
    if (!chrome.downloads?.download) {
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    chrome.downloads.download({ url, filename: full, saveAs: r.downloadAskWhere === true }, () => {
      void chrome.runtime.lastError;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  });
}

function exportLibrary() {
  chrome.storage.local.get(['savedTests'], (r) => {
    saveDashDownload(
      new Blob([JSON.stringify(r.savedTests || [], null, 2)], { type: 'application/json' }),
      `flow-qa-testes-${new Date().toISOString().slice(0, 10)}.json`
    );
  });
}

function importLibrary(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let imported;
    try {
      imported = JSON.parse(String(reader.result));
    } catch (err) {
      showStatus(tt(`Arquivo inválido: ${err.message}`, `Invalid file: ${err.message}`), 'error');
      return;
    }
    if (!Array.isArray(imported)) { showStatus(tt('O arquivo deve conter um array de testes', 'The file must contain an array of tests'), 'error'); return; }
    const valid = imported.filter((t) => t && typeof t === 'object' && t.name && t.prompt);
    const discarded = imported.length - valid.length;
    chrome.storage.local.get(['savedTests'], (r) => {
      const current = r.savedTests || [];
      const byId = new Map(current.map((t) => [t.id, t]));
      let added = 0, updated = 0;
      for (const t of valid) {
        if (t.id && byId.has(t.id)) { Object.assign(byId.get(t.id), t); updated++; }
        else { current.unshift({ ...t, id: t.id || Date.now() + added }); added++; }
      }
      chrome.storage.local.set({ savedTests: current }, () => {
        showStatus(tt(
          `✓ Importado: ${added} novo(s), ${updated} atualizado(s)${discarded > 0 ? `, ${discarded} ignorado(s) por faltar nome/prompt` : ''}`,
          `✓ Imported: ${added} new, ${updated} updated${discarded > 0 ? `, ${discarded} skipped (missing name/prompt)` : ''}`
        ), 'success');
        refreshLibraryStats();
      });
    });
  };
  reader.readAsText(file);
  e.target.value = '';
}
