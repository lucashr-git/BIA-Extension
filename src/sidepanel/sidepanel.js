import {
  DEFAULT_MODEL, DEFAULT_MAX_STEPS, clampMaxSteps, isRestrictedUrl, sanitizePathSegment,
  CHAT_MODES, CHAT_MODELS, DEFAULT_CHAT_MODE, normalizeChatMode, chatModeConfig,
  chatModelLabel, modelTransport,
} from '../shared/constants.js';
import { doneLabel } from '../shared/actionLabels.js';
import { substituteVars, parseDataset, expandBatchItems, parseEnvironments } from '../shared/vars.js';
import { computeFlakyMap } from '../shared/insights.js';

let isDarkMode    = false;
let agentRunning  = false;
let userStopped   = false;
let lastResult    = null;
let bugScreenshot = null;
let inspecting    = false;
let pendingConfirmId = null;
let stopFallbackTimer = null;
let recording      = false;
let recordingTabId = null;
let recordedCount  = 0;
let batchRunning   = false;
let lastBatchData  = null;
let environments   = {};
let activeEnvName  = '';
let selectedTests  = new Set();
let loadedZephyrKey = null;
let loadedTestId = null;
let featureFlags = {};
let chatRunning  = false;
let chatPendingConfirmId = null;
let chatCurrentTurnEl    = null;
let accessibilityMode = false;
let micRecognition    = null;
let micListening      = false;
let uiLang            = 'pt';

const featEnabled = (key) => featureFlags[key] !== false;

const $ = (id) => document.getElementById(id);

const settingsBtn   = $('settingsBtn');

const tabBtns       = document.querySelectorAll('.tab-btn');
const tabContents   = document.querySelectorAll('.tab-content');

const runIdle           = $('runIdle');
const runRunning        = $('runRunning');
const runResult         = $('runResult');
const testInput         = $('testInput');
const runBtn            = $('runBtn');
const runError          = $('runError');
const runningStatusText = $('runningStatusText');
const liveStepsList     = $('liveStepsList');
const stopBtn           = $('stopBtn');
const resultVerdict     = $('resultVerdict');
const resultStepsList   = $('resultStepsList');
const resultAIDetails   = $('resultAIDetails');
const resultAIText      = $('resultAIText');
const resultJiraBtn     = $('resultJiraBtn');
const resultSaveBtn     = $('resultSaveBtn');
const resultBugBtn      = $('resultBugBtn');
const resultNewBtn      = $('resultNewBtn');
const copyAIBtn         = $('copyAIBtn');

const librarySearch = $('librarySearch');
const libraryList   = $('libraryList');
const libraryEmpty  = $('libraryEmpty');

const debugIdle    = $('debugIdle');
const debugRunning = $('debugRunning');
const debugResult  = $('debugResult');
const debugRunBtn  = $('debugRunBtn');

const inspectToggleBtn   = $('inspectToggleBtn');
const inspectToggleLabel = $('inspectToggleLabel');
const inspectedCard      = $('inspectedCard');
const inspectedSelector  = $('inspectedSelector');
const inspectedDetails   = $('inspectedDetails');
const inspectEmpty       = $('inspectEmpty');
const copySelectorBtn    = $('copySelectorBtn');
const contextRefreshBtn  = $('contextRefreshBtn');
const contextContent     = $('contextContent');

const confirmBar        = $('confirmBar');
const confirmBarText    = $('confirmBarText');
const confirmApproveBtn = $('confirmApproveBtn');
const confirmDenyBtn    = $('confirmDenyBtn');

const bugReportOverlay = $('bugReportOverlay');
const closeBugModal    = $('closeBugModal');

const envSelect            = $('envSelect');
const recordBtn            = $('recordBtn');
const datasetInput         = $('datasetInput');
const datasetDetails       = $('datasetDetails');
const runRecording         = $('runRecording');
const recordingStatusText  = $('recordingStatusText');
const recordStopBtn        = $('recordStopBtn');
const runBatch             = $('runBatch');
const batchStatusText      = $('batchStatusText');
const batchStopBtn         = $('batchStopBtn');
const batchProgressList    = $('batchProgressList');
const runBatchResult       = $('runBatchResult');
const batchSummary         = $('batchSummary');
const batchResultList      = $('batchResultList');
const batchPdfBtn          = $('batchPdfBtn');
const batchNewBtn          = $('batchNewBtn');
const resultPdfBtn         = $('resultPdfBtn');
const libraryBatchBar      = $('libraryBatchBar');
const librarySelCount      = $('librarySelCount');
const libraryRunSelectedBtn = $('libraryRunSelectedBtn');
const zephyrPushArea    = $('zephyrPushArea');
const zephyrPushKey     = $('zephyrPushKey');
const zephyrCycleSelect = $('zephyrCycleSelect');
const zephyrPushBtn     = $('zephyrPushBtn');
const suggestBtn        = $('suggestBtn');
const suggestBox        = $('suggestBox');
const batchRepeatSelect = $('batchRepeatSelect');
const batchAllEnvs      = $('batchAllEnvs');
const batchParallelSelect = $('batchParallelSelect');
const batchJsonBtn      = $('batchJsonBtn');
const videoDetails      = $('videoDetails');
const runVideo          = $('runVideo');
const videoDownloadBtn  = $('videoDownloadBtn');
const visualDiffArea    = $('visualDiffArea');
const chatThreadEl       = $('chatThread');
const chatEmpty          = $('chatEmpty');
const chatInput          = $('chatInput');
const chatSendBtn        = $('chatSendBtn');
const chatStopBtn        = $('chatStopBtn');
const chatNewBtn         = $('chatNewBtn');
const chatConfirm        = $('chatConfirm');
const chatConfirmText    = $('chatConfirmText');
const chatConfirmApprove = $('chatConfirmApprove');
const chatConfirmDeny    = $('chatConfirmDeny');
const chatHistoryBtn     = $('chatHistoryBtn');
const chatModeBtn        = $('chatModeBtn');
const chatModeLabel      = $('chatModeLabel');
const chatModeMenu       = $('chatModeMenu');
const chatModelBtn       = $('chatModelBtn');
const chatModelLabelEl   = $('chatModelLabel');
const chatModelMenu      = $('chatModelMenu');
const chatHistoryOverlay = $('chatHistoryOverlay');
const chatHistoryListEl  = $('chatHistoryList');
const chatHistoryEmpty   = $('chatHistoryEmpty');
const closeChatHistory   = $('closeChatHistory');
const accessBtn          = $('accessBtn');
const chatMicBtn         = $('chatMicBtn');
const srAnnouncer        = $('srAnnouncer');

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['language'], (r) => {
    uiLang = r.language === 'en' ? 'en' : 'pt';
    if (uiLang === 'en') applyEnglishUI();
    loadTheme();
    loadEnvironments();
    applyFeatureFlags();
    setupListeners();
    initComposerPickers();
    renderLibrary();
    initTabGrouping();
    checkJiraConfig();
    rehydrateRunState();
    restoreChatThread();
    loadAccessibilityMode();
  });
});

let themeMode = 'system';
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');
systemDarkQuery.addEventListener('change', () => { if (themeMode === 'system') applyTheme(); });

function loadTheme() {
  chrome.storage.local.get(['themeMode', 'darkMode'], (r) => {
    themeMode = r.themeMode || (r.darkMode === true ? 'dark' : r.darkMode === false ? 'light' : 'system');
    applyTheme();
  });
}

function applyTheme() {
  isDarkMode = themeMode === 'system' ? systemDarkQuery.matches : themeMode === 'dark';
  document.body.classList.toggle('dark', isDarkMode);
}

function switchTab(name) {
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  tabContents.forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
  if (name === 'library') renderLibrary();
  if (name !== 'inspect' && inspecting) toggleInspect();
}

function setRunState(state) {
  runIdle.classList.toggle('hidden', state !== 'idle');
  runRunning.classList.toggle('hidden', state !== 'running');
  runResult.classList.toggle('hidden', state !== 'result');
  runRecording.classList.toggle('hidden', state !== 'recording');
  runBatch.classList.toggle('hidden', state !== 'batch');
  runBatchResult.classList.toggle('hidden', state !== 'batchResult');
}

function showRunError(msg) {
  runError.textContent = msg;
  runError.classList.remove('hidden');
  setTimeout(() => runError.classList.add('hidden'), 6000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'agentStatus' && agentRunning) {
    updateRunningStatus(msg.text);
    addLiveStep(msg.text);
    videoStatusText = msg.text;
  }

  if (msg.action === 'agentStatus' && chatRunning) {
    appendChatActivity(msg.text);
  }

  if (msg.action === 'chatDelta') {
    handleChatDelta(msg.text || '', !!msg.done);
  }

  if (msg.action === 'chatDone') {
    finishAssistantTurn(msg.turn || {});
  }

  if (msg.action === 'agentDone') {
    handleAgentDone(msg.lastRun);
  }

  if (msg.action === 'agentConfirmRequest') {
    if (chatRunning) {
      showChatConfirm(msg.id, msg.description);
    } else {
      pendingConfirmId = msg.id;
      confirmBarText.textContent = msg.description || t('sensitiveDefault');
      confirmBar.classList.remove('hidden');
    }
  }
  if (msg.action === 'agentConfirmClosed') {
    if (msg.id === chatPendingConfirmId) hideChatConfirm();
    if (msg.id === pendingConfirmId) {
      pendingConfirmId = null;
      confirmBar.classList.add('hidden');
    }
  }

  if (msg.action === 'flowQaInspectResult' && msg.element) {
    renderInspectedElement(msg.element);
  }

  if (msg.action === 'batchProgress' && batchRunning) {
    batchStatusText.textContent = `Executando ${msg.index + 1} de ${msg.total}: ${msg.name}`;
    addBatchProgressLine(`▶ [${msg.index + 1}/${msg.total}] ${msg.name}`);
  }

  if (msg.action === 'batchDone') {
    userStopped = false;
    clearTimeout(stopFallbackTimer);
    confirmBar.classList.add('hidden');
    pendingConfirmId = null;
    renderBatchResult(msg.lastBatch || { results: [] });
  }

  if (msg.action === 'screencastFrame') {
    drawVideoFrame(msg.data);
  }

  if (msg.action === 'flowQaRecorderEvent' && recording) {
    recordedCount++;
    recordingStatusText.textContent = `Gravando… ${recordedCount} ação(ões) capturadas`;
  }
});

function answerConfirmation(approved) {
  if (!pendingConfirmId) return;
  chrome.runtime.sendMessage({ action: 'agentConfirmResponse', id: pendingConfirmId, approved });
  pendingConfirmId = null;
  confirmBar.classList.add('hidden');
  addLiveStep(approved ? '✅ Ação sensível aprovada por você' : '🚫 Ação sensível negada por você');
}

/* ===== Idioma (pt-BR / English) ===== */

const I18N = {
  pt: {
    running: 'Executando…',
    activities: (n) => `${n} atividade(s) · ver detalhes`,
    done: 'Concluído.',
    startFail: 'Não foi possível iniciar. Verifique as configurações (⚙️).',
    stopping: '⏹️ Parando…',
    sensitiveDefault: 'A IA quer executar uma ação sensível.',
    approvedByYou: '✅ Ação sensível aprovada por você',
    deniedByYou: '🚫 Ação sensível negada por você',
    reopened: '🔄 Painel reaberto — execução em andamento',
    messages: (n) => `${n} mensagem(ns)`,
    conversation: 'Conversa',
    deleteConv: 'Excluir conversa',
    openConvFail: 'Não foi possível abrir a conversa.',
    a11yOn: 'Modo acessível ativado. As respostas da Bia serão lidas em voz alta. Use o botão de microfone, ao lado do campo de texto, para falar com ela.',
    a11yOff: 'Modo acessível desativado.',
    micUnavailable: 'O reconhecimento de voz não está disponível neste navegador.',
    micBusy: 'A Bia ainda está trabalhando. Aguarde a resposta para enviar outro comando.',
    micReady: 'Microfone ativado, pode falar.',
    micDenied: 'A permissão do microfone foi negada. Autorize o microfone para esta extensão nas configurações do Chrome e tente de novo.',
    micFail: 'Não consegui te ouvir. Tente novamente.',
    sending: (text) => `Enviando: ${text}`,
    biaReplied: (text) => `Bia respondeu: ${text}`,
    codeOmitted: ' trecho de código omitido. ',
    linkWord: ' link ',
    dateLocale: 'pt-BR',
  },
  en: {
    running: 'Working…',
    activities: (n) => `${n} step(s) · view details`,
    done: 'Done.',
    startFail: 'Could not start. Check the settings (⚙️).',
    stopping: '⏹️ Stopping…',
    sensitiveDefault: 'The AI wants to perform a sensitive action.',
    approvedByYou: '✅ Sensitive action approved by you',
    deniedByYou: '🚫 Sensitive action denied by you',
    reopened: '🔄 Panel reopened — run in progress',
    messages: (n) => `${n} message(s)`,
    conversation: 'Conversation',
    deleteConv: 'Delete conversation',
    openConvFail: 'Could not open the conversation.',
    a11yOn: 'Accessible mode enabled. Bia\'s replies will be read aloud. Use the microphone button next to the text field to talk to her.',
    a11yOff: 'Accessible mode disabled.',
    micUnavailable: 'Speech recognition is not available in this browser.',
    micBusy: 'Bia is still working. Wait for the reply before sending another command.',
    micReady: 'Microphone on, you can speak.',
    micDenied: 'Microphone permission was denied. Allow the microphone for this extension in Chrome settings and try again.',
    micFail: 'I could not hear you. Please try again.',
    sending: (text) => `Sending: ${text}`,
    biaReplied: (text) => `Bia replied: ${text}`,
    codeOmitted: ' code snippet omitted. ',
    linkWord: ' link ',
    dateLocale: 'en-US',
  },
};

function t(key, arg) {
  const entry = (I18N[uiLang] || I18N.pt)[key];
  return typeof entry === 'function' ? entry(arg) : entry;
}

function setNodeText(el, text) {
  if (!el) return;
  for (let i = el.childNodes.length - 1; i >= 0; i--) {
    const n = el.childNodes[i];
    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
      n.textContent = ' ' + text;
      return;
    }
  }
  el.append(' ' + text);
}

function applyEnglishUI() {
  const ops = [
    ['.tab-btn[data-tab="run"] .tab-label', 'text', 'Run'],
    ['.tab-btn[data-tab="library"] .tab-label', 'text', 'Tests'],
    ['.tab-btn[data-tab="inspect"] .tab-label', 'text', 'Inspector'],
    ['#accessBtn', 'title', 'Accessible mode: spoken replies and microphone commands'],
    ['#accessBtn', 'aria-label', 'Toggle accessible mode'],
    ['#settingsBtn', 'title', 'Settings'],
    ['#settingsBtn', 'aria-label', 'Open settings'],
    ['#chatEmpty .empty-title', 'text', 'Talk to Bia'],
    ['#chatEmpty .empty-desc', 'html', 'Ask in natural language and Bia acts on the <strong>active tab</strong> and replies here.<br>E.g.: "search for laptops and tell me the first result".'],
    ['.chat-empty-brand span', 'text', 'Bia · your AI agent in the browser'],
    ['#chatConfirm .confirm-bar-title', 'text', '⚠️ Confirmation required'],
    ['#chatConfirmApprove', 'text', '✓ Approve and continue'],
    ['#chatConfirmDeny', 'text', '✕ Deny'],
    ['#chatNewBtn', 'title', 'New conversation'],
    ['#chatNewBtn', 'aria-label', 'New conversation'],
    ['#chatHistoryBtn', 'title', 'Conversation history'],
    ['#chatHistoryBtn', 'aria-label', 'Conversation history'],
    ['#chatMicBtn', 'title', 'Talk to Bia'],
    ['#chatMicBtn', 'aria-label', 'Talk to Bia using the microphone'],
    ['#chatInput', 'placeholder', 'Ask Bia anything…'],
    ['.chat-composer-hint .hint-full', 'text', 'Enter sends · Shift+Enter new line'],
    ['.chat-composer-hint .hint-short', 'text', 'Enter sends'],
    ['#chatSendBtn', 'title', 'Send'],
    ['#chatSendBtn', 'aria-label', 'Send message'],
    ['#chatStopBtn', 'title', 'Stop'],
    ['#chatStopBtn', 'aria-label', 'Stop run'],
    ['#chatHistoryOverlay .modal-header span', 'text', '🕘 Conversation history'],
    ['#chatHistoryEmpty', 'html', 'No conversations saved yet.<br>Chat with Bia and it will appear here.'],
    ['.input-hint', 'text', 'Ctrl+Enter to run'],
    ['#envSelect option[value=""]', 'text', 'No environment'],
    ['#recordBtn', 'nodeText', 'Record'],
    ['#testInput', 'placeholder', 'Describe what to test in natural language, or write numbered steps:\n\n1. Go to /login\n2. Fill email with qa@company.com\n3. Fill the password\n4. Click Sign in\n5. Check that the URL changes to /dashboard\n6. Check that the user name is in the header'],
    ['#datasetDetails summary', 'text', 'Data — data-driven (optional)'],
    ['#runBtn', 'nodeText', 'Run Test'],
    ['#stopBtn', 'nodeText', 'Stop'],
    ['#recordStopBtn', 'nodeText', 'Stop and generate'],
    ['#batchStopBtn', 'nodeText', 'Stop'],
    ['.recording-hint', 'text', 'Use the page normally — clicks, typing, selections and navigation are being captured. When you stop, the test case is generated here for you to review and save.'],
    ['#confirmBar .confirm-bar-title', 'text', '⚠️ Confirmation required'],
    ['#confirmApproveBtn', 'text', '✓ Approve and continue'],
    ['#confirmDenyBtn', 'text', '✕ Deny'],
    ['#resultAIDetails summary span', 'text', 'View agent analysis'],
    ['#copyAIBtn', 'title', 'Copy analysis'],
    ['#videoDetails summary', 'text', '🎬 Execution video'],
    ['#videoDownloadBtn', 'nodeText', 'Download .webm'],
    ['#resultJiraBtn', 'nodeText', 'Create Jira Bug'],
    ['#resultSaveBtn', 'nodeText', 'Save Test'],
    ['#resultBugBtn', 'nodeText', 'Bug Report'],
    ['#resultPdfBtn', 'nodeText', 'PDF'],
    ['#resultNewBtn', 'nodeText', 'New'],
    ['#batchPdfBtn', 'nodeText', 'PDF'],
    ['#batchJsonBtn', 'nodeText', 'JSON'],
    ['#batchNewBtn', 'nodeText', 'New'],
    ['#zephyrPushBtn', 'text', 'Send to Zephyr'],
    ['#zephyrCycleSelect option[value=""]', 'text', 'No cycle'],
    ['#librarySearch', 'placeholder', 'Search by name, tag or suite...'],
    ['#suggestBtn', 'text', '💡 Suggest'],
    ['#suggestBtn', 'title', 'The AI analyzes the current page and suggests test cases'],
    ['#libraryRunSelectedBtn', 'nodeText', 'Run'],
    ['.batch-envs-label', 'nodeText', 'environments'],
    ['#libraryEmpty .empty-title', 'text', 'No saved tests'],
    ['#libraryEmpty .empty-desc', 'html', 'Run a test in the <strong>Run</strong> tab and click "Save Test" to reuse it here.'],
    ['.debug-intro-title', 'text', 'Quality Analysis'],
    ['.debug-intro-desc', 'text', 'Inspects the current page and automatically detects security, accessibility, performance and JavaScript issues.'],
    ['#debugRunBtn', 'nodeText', 'Analyze Page'],
    ['#debugRunning p', 'text', 'Collecting page data...'],
    ['#inspectToggleLabel', 'text', 'Inspect'],
    ['#contextRefreshBtn', 'nodeText', 'Refresh'],
    ['#inspectEmpty p', 'text', 'Nothing inspected yet.'],
    ['.inspect-empty-inline', 'text', 'Click "Refresh" to capture the active tab context.'],
    ['#copySelectorBtn', 'title', 'Copy selector'],
  ];
  for (const [sel, kind, value] of ops) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (kind === 'text') el.textContent = value;
    else if (kind === 'html') el.innerHTML = value;
    else if (kind === 'nodeText') setNodeText(el, value);
    else el.setAttribute(kind, value);
  }
  const inspectTitles = document.querySelectorAll('.inspect-title');
  const inspectDescs = document.querySelectorAll('.inspect-desc');
  if (inspectTitles[0]) inspectTitles[0].textContent = 'Element Inspector';
  if (inspectTitles[1]) inspectTitles[1].textContent = 'Page Context';
  if (inspectDescs[0]) inspectDescs[0].textContent = 'Enable and click any element on the page to capture the best selector.';
  if (inspectDescs[1]) inspectDescs[1].textContent = 'What the AI sees: detected elements, console and network in real time.';
  const debugTags = document.querySelectorAll('.debug-tags span');
  const tagsEn = ['🔒 Security', '♿ Accessibility', '⚡ Performance', '🔑 JWT Tokens', '🌐 Network', '⚠️ JS Errors'];
  debugTags.forEach((el, i) => { if (tagsEn[i]) el.textContent = tagsEn[i]; });
}

/* ===== Modo Acessível (deficiência visual) ===== */

function loadAccessibilityMode() {
  window.speechSynthesis?.getVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  chrome.storage.local.get(['accessibilityMode'], (r) => {
    accessibilityMode = r.accessibilityMode === true;
    applyAccessibilityMode();
  });
}

function applyAccessibilityMode() {
  accessBtn.classList.toggle('access-on', accessibilityMode);
  accessBtn.setAttribute('aria-pressed', String(accessibilityMode));
  chatMicBtn.classList.toggle('hidden', !accessibilityMode);
  if (!accessibilityMode) {
    stopMicListening();
    window.speechSynthesis?.cancel();
  }
}

function toggleAccessibilityMode() {
  accessibilityMode = !accessibilityMode;
  chrome.storage.local.set({ accessibilityMode });
  applyAccessibilityMode();
  speak(accessibilityMode ? t('a11yOn') : t('a11yOff'), true);
}

function stripForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, t('codeOmitted'))
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, t('linkWord'))
    .replace(/[*_#>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBiaVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const primary = uiLang === 'en' ? /^en[-_](us|gb)/i : /^pt[-_]br/i;
  const anyLang = uiLang === 'en' ? /^en/i : /^pt/i;
  const main = voices.filter((v) => primary.test(v.lang || ''));
  const rest = voices.filter((v) => anyLang.test(v.lang || ''));
  const female = uiLang === 'en'
    ? /samantha|victoria|karen|moira|ava|allison|susan|zira|jenny|aria|serena|kate|female/i
    : /luciana|francisca|fernanda|camila|vit[óo]ria|let[íi]cia|helena|isabela|manuela|maria|ana|bia|female|feminina|mulher/i;
  return (
    main.find((v) => female.test(v.name)) ||
    main.find((v) => /google/i.test(v.name)) ||  // vozes "Google ..." são femininas
    main[0] ||
    rest.find((v) => female.test(v.name)) ||
    rest[0] ||
    null
  );
}

function speak(text, force = false) {
  if (!accessibilityMode && !force) return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = uiLang === 'en' ? 'en-US' : 'pt-BR';
  const voice = pickBiaVoice();
  if (voice) utter.voice = voice;
  synth.speak(utter);
}

function announce(text) {
  srAnnouncer.textContent = text;
}

function stopMicListening() {
  micListening = false;
  chatMicBtn.classList.remove('listening');
  if (micRecognition) {
    try { micRecognition.stop(); } catch (_) {}
    micRecognition = null;
  }
}

function startMicListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    speak(t('micUnavailable'), true);
    return;
  }
  if (chatRunning) {
    speak(t('micBusy'), true);
    return;
  }
  window.speechSynthesis?.cancel();
  micRecognition = new SR();
  micRecognition.lang = uiLang === 'en' ? 'en-US' : 'pt-BR';
  micRecognition.interimResults = false;
  micRecognition.maxAlternatives = 1;
  micListening = true;
  chatMicBtn.classList.add('listening');
  announce(t('micReady'));

  micRecognition.onresult = (e) => {
    const text = (e.results[0]?.[0]?.transcript || '').trim();
    stopMicListening();
    if (!text) return;
    chatInput.value = text;
    autoGrowChatInput();
    speak(t('sending', text));
    sendChatMessage();
  };
  micRecognition.onerror = (e) => {
    stopMicListening();
    const msg = e.error === 'not-allowed' || e.error === 'service-not-allowed'
      ? t('micDenied')
      : t('micFail');
    speak(msg, true);
    announce(msg);
  };
  micRecognition.onend = () => stopMicListening();
  micRecognition.start();
}

/* ===== Chat ===== */

/* --- Seletores de modo e modelo no composer --- */

let chatMode = DEFAULT_CHAT_MODE;
let chatModel = '';        // vazio = usa o modelo global das Configurações
let globalModel = '';
let discoveredModels = []; // IDs confirmados pelo proxy via GET /v1/models

const CUSTOM_MODEL_ID = '__custom__';

function currentChatModelId() {
  return chatModel || globalModel || DEFAULT_MODEL;
}

// As ferramentas são traduzidas para o formato OpenAI, mas o proxy é otimizado para
// Anthropic: em GPT/Gemini o tool calling pode falhar. Avisa sem impedir.
function agentModeWarning() {
  return modelTransport(currentChatModelId()) === 'openai'
    ? 'Com GPT/Gemini as ferramentas podem falhar — se der erro, volte para Haiku ou Sonnet.'
    : '';
}

function closeComposerMenus() {
  for (const [menu, btn] of [[chatModeMenu, chatModeBtn], [chatModelMenu, chatModelBtn]]) {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }
}

function toggleComposerMenu(menu, btn) {
  const willOpen = menu.classList.contains('hidden');
  closeComposerMenus();
  if (!willOpen) return;
  menu.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('.composer-menu-item:not(:disabled)')?.focus();
}

function buildMenuItem({ label, hint, tag, checked, disabled, onSelect }) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'composer-menu-item';
  item.setAttribute('role', 'menuitemradio');
  item.setAttribute('aria-checked', checked ? 'true' : 'false');
  if (disabled) item.disabled = true;
  item.innerHTML = `
    <span class="composer-menu-item-top">
      <span>${esc(label)}</span>
      ${tag ? `<span class="composer-menu-tag">${esc(tag)}</span>` : ''}
      <span class="composer-menu-item-check">✓</span>
    </span>
    ${hint ? `<span class="composer-menu-item-hint">${esc(hint)}</span>` : ''}`;
  item.addEventListener('click', () => {
    closeComposerMenus();
    onSelect();
  });
  return item;
}

function renderChatModeMenu() {
  chatModeMenu.textContent = '';
  const warning = agentModeWarning();
  for (const m of CHAT_MODES) {
    chatModeMenu.appendChild(buildMenuItem({
      label: m.label,
      hint: m.id === 'agent' && warning ? `${m.hint}. ${warning}` : m.hint,
      tag: m.id === 'agent' && warning ? 'atenção' : '',
      checked: chatMode === m.id,
      onSelect: () => setChatMode(m.id),
    }));
  }
}

// Lista efetiva: o que o proxy respondeu (se já perguntamos) tem prioridade sobre a lista
// fixa, porque nome comercial ("GPT 5.5") raramente é igual ao ID técnico.
function effectiveModelList() {
  if (!discoveredModels.length) return CHAT_MODELS;
  // Os curados vêm primeiro (são os testados, com rótulo e tempo medido); o resto do que
  // o proxy listou vai para "Outros do proxy", sem promessa de que funcione.
  const known = new Map(CHAT_MODELS.map((m) => [m.id, m]));
  const extras = discoveredModels
    .filter((id) => !known.has(id))
    .map((id) => ({ id, group: 'Outros do proxy', label: chatModelLabel(id), hint: id, transport: modelTransport(id) }));
  return [...CHAT_MODELS, ...extras];
}

function appendMenuGroupLabel(menu, text) {
  const el = document.createElement('div');
  el.className = 'composer-menu-group';
  el.textContent = text;
  menu.appendChild(el);
}

function renderChatModelMenu() {
  chatModelMenu.textContent = '';
  const current = currentChatModelId();
  const list = effectiveModelList();
  const isKnown = list.some((m) => m.id === current);
  let lastGroup = null;
  for (const m of list) {
    if (m.group && m.group !== lastGroup) {
      appendMenuGroupLabel(chatModelMenu, m.group);
      lastGroup = m.group;
    }
    chatModelMenu.appendChild(buildMenuItem({
      label: m.label,
      hint: m.hint,
      checked: current === m.id,
      onSelect: () => setChatModel(m.id),
    }));
  }
  chatModelMenu.appendChild(buildMenuItem({
    label: 'Outro…',
    hint: isKnown ? 'Informar o ID de um modelo do proxy Flow' : `Atual: ${current}`,
    checked: !isKnown,
    onSelect: () => promptCustomModel(),
  }));
  chatModelMenu.appendChild(buildMenuItem({
    label: '↻ Atualizar do proxy',
    hint: discoveredModels.length
      ? `${discoveredModels.length} modelo(s) confirmados pelo seu token`
      : 'Pergunta ao Flow quais modelos o seu token libera',
    checked: false,
    onSelect: () => refreshModelList(),
  }));
}

async function refreshModelList() {
  appendChatBubble('assistant', '↻ Consultando os modelos disponíveis no proxy Flow…');
  const res = await sendMsg('listModels', {}, 20000);
  const last = chatThreadEl.lastElementChild;
  if (res?.models?.length) {
    discoveredModels = res.models;
    syncComposerPills();
    last.querySelector('.chat-answer').innerHTML = renderMarkdown(
      `✓ ${res.models.length} modelo(s) liberados para o seu token:\n\n${res.models.map((m) => `- \`${m}\``).join('\n')}\n\nEles já estão no seletor de modelo.`
    );
  } else {
    last.classList.add('chat-error');
    last.querySelector('.chat-answer').innerHTML = renderMarkdown(
      `Não consegui listar os modelos: ${res?.error || 'sem resposta do gateway'}.\n\nA lista fixa continua valendo — use "Outro…" para informar um ID manualmente.`
    );
  }
  chatScrollToBottom();
}

function promptCustomModel() {
  const value = window.prompt(
    'ID do modelo no proxy Flow (ex.: anthropic.claude-4-6-sonnet).\nDeixe vazio para voltar ao modelo das Configurações.',
    CHAT_MODELS.some((m) => m.id === currentChatModelId()) ? '' : currentChatModelId()
  );
  if (value === null) return;
  setChatModel(value.trim());
}

function syncComposerPills() {
  chatModeLabel.textContent = chatModeConfig(chatMode).label;
  chatModelLabelEl.textContent = chatModelLabel(currentChatModelId());
  chatModelBtn.title = `Modelo do chat: ${currentChatModelId()}`;
  renderChatModeMenu();
  renderChatModelMenu();
}

function setChatMode(mode, { persist = true } = {}) {
  chatMode = normalizeChatMode(mode);
  syncComposerPills();
  updateChatPlaceholder();
  if (persist) chrome.storage.local.set({ chatMode }).catch(() => {});
}

function setChatModel(model, { persist = true } = {}) {
  chatModel = String(model || '').trim();
  syncComposerPills();
  if (persist) chrome.storage.local.set({ chatModel }).catch(() => {});
}

function updateChatPlaceholder() {
  const en = uiLang === 'en';
  chatInput.placeholder = chatMode === 'translate'
    ? (en ? 'Paste the text to translate…' : 'Cole o texto para traduzir…')
    : chatMode === 'chat'
      ? (en ? 'Ask Bia anything…' : 'Pergunte algo à Bia…')
      : (en ? 'Ask Bia to do something…' : 'Peça algo à Bia…');
}

function initComposerPickers() {
  chatModeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleComposerMenu(chatModeMenu, chatModeBtn); });
  chatModelBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleComposerMenu(chatModelMenu, chatModelBtn); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.composer-picker')) closeComposerMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeComposerMenus();
  });

  chrome.storage.local.get(['chatMode', 'chatModel', 'model', 'chatModelsCache'], (r) => {
    globalModel = r.model || '';
    chatModel = r.chatModel || '';
    chatMode = normalizeChatMode(r.chatMode);
    discoveredModels = Array.isArray(r.chatModelsCache?.models) ? r.chatModelsCache.models : [];
    syncComposerPills();
    updateChatPlaceholder();
  });

  // O modelo global pode mudar nas Configurações com o painel aberto.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.model) return;
    globalModel = changes.model.newValue || '';
    if (!chatModel) syncComposerPills();
  });
}

function chatScrollToBottom() {
  chatThreadEl.scrollTop = chatThreadEl.scrollHeight;
}

// Margem de tolerância para considerar que o usuário "está no fundo" do thread — evita
// roubar o scroll de quem subiu pra reler algo enquanto a resposta ainda está streamando.
const CHAT_BOTTOM_THRESHOLD = 24;
function isChatAtBottom() {
  return (chatThreadEl.scrollHeight - chatThreadEl.scrollTop - chatThreadEl.clientHeight) < CHAT_BOTTOM_THRESHOLD;
}

// Renderiza o streaming de resposta (chatDelta): `text` é o texto ACUMULADO da resposta em
// progresso, então cada chamada SUBSTITUI o conteúdo da bolha (idempotente), nunca concatena.
// Na primeira chegada de um turno, cria/reaproveita a bolha do assistente (a mesma criada por
// beginAssistantTurn no envio da mensagem, se existir). O 'chatDone' que chega depois continua
// sendo a fonte da verdade e reaproveita essa mesma bolha (chatCurrentTurnEl) — sem duplicar.
function handleChatDelta(text, done) {
  const wasAtBottom = isChatAtBottom();
  const el = chatCurrentTurnEl || beginAssistantTurn();
  el.querySelector('.chat-typing')?.remove();
  const answerEl = el.querySelector('.chat-answer');
  if (answerEl) {
    answerEl.innerHTML = renderMarkdown(text);
    answerEl.classList.toggle('chat-streaming-cursor', !done);
  }
  if (wasAtBottom) chatScrollToBottom();
}

function setChatRunning(running) {
  chatRunning = running;
  chatSendBtn.classList.toggle('hidden', running);
  chatStopBtn.classList.toggle('hidden', !running);
  chatHistoryBtn.disabled = running;
  chatModeBtn.disabled = running;
  chatModelBtn.disabled = running;
  if (running) closeComposerMenus();
}

// O modo Agente é o padrão; só os outros ganham etiqueta, para não poluir a conversa.
function modeBadgeHtml(mode) {
  const id = normalizeChatMode(mode);
  if (id === DEFAULT_CHAT_MODE) return '';
  return `<span class="chat-mode-badge">${esc(chatModeConfig(id).label)}</span>`;
}

function appendChatBubble(role, text, { error = false, mode = '' } = {}) {
  chatEmpty.classList.add('hidden');
  const el = document.createElement('div');
  el.className = `chat-msg chat-${role}${error ? ' chat-error' : ''}`;
  const badge = role === 'user' ? modeBadgeHtml(mode) : '';
  if (role === 'assistant') el.innerHTML = `<div class="chat-answer">${renderMarkdown(text)}</div>`;
  else if (badge) el.innerHTML = `${badge}<div>${esc(text)}</div>`;
  else el.textContent = text;
  chatThreadEl.appendChild(el);
  chatScrollToBottom();
  return el;
}

// Botão de copiar: no Tradutor a resposta existe para ser colada em outro lugar.
function appendCopyButton(container, text) {
  if (!text) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-copy-btn';
  btn.textContent = '⧉ Copiar';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = '⧉ Copiar'; }, 1600);
    } catch (_) {
      btn.textContent = '✕ Falhou';
      setTimeout(() => { btn.textContent = '⧉ Copiar'; }, 1600);
    }
  });
  container.appendChild(btn);
}

function beginAssistantTurn(mode = '') {
  chatEmpty.classList.add('hidden');
  const el = document.createElement('div');
  el.className = 'chat-msg chat-assistant chat-pending';
  if (mode) el.dataset.mode = normalizeChatMode(mode);
  // O Tradutor não usa ferramentas: um bloco de atividades vazio só ocuparia espaço.
  const activity = mode === 'translate' ? '' : `
    <details class="chat-activity" open>
      <summary class="chat-activity-summary">${esc(t('running'))}</summary>
      <div class="chat-activity-list"></div>
    </details>`;
  el.innerHTML = `${activity}
    <div class="chat-typing"><span></span><span></span><span></span></div>
    <div class="chat-answer"></div>`;
  chatThreadEl.appendChild(el);
  chatCurrentTurnEl = el;
  chatScrollToBottom();
  return el;
}

function appendChatActivity(text) {
  if (!chatCurrentTurnEl) return;
  let list = chatCurrentTurnEl.querySelector('.chat-activity-list');
  // O Tradutor começa sem bloco de atividades (não usa ferramentas), mas ainda precisa
  // conseguir mostrar um aviso de retry do gateway em vez de engolir a mensagem.
  if (!list) {
    const details = document.createElement('details');
    details.className = 'chat-activity';
    details.open = true;
    details.innerHTML = `<summary class="chat-activity-summary">${esc(t('running'))}</summary><div class="chat-activity-list"></div>`;
    chatCurrentTurnEl.prepend(details);
    list = details.querySelector('.chat-activity-list');
  }
  const item = document.createElement('div');
  item.className = 'chat-activity-item';
  item.textContent = text;
  list.appendChild(item);
  while (list.children.length > 40) list.removeChild(list.firstChild);
  chatScrollToBottom();
}

function finishAssistantTurn(turn) {
  setChatRunning(false);
  hideChatConfirm();
  const el = chatCurrentTurnEl;
  chatCurrentTurnEl = null;
  const reply = turn.reply || '';
  const error = turn.error || '';
  if (!el) {
    if (reply || error) appendChatBubble('assistant', reply || error, { error: !!(error && !reply) });
    return;
  }
  el.classList.remove('chat-pending');
  el.querySelector('.chat-typing')?.remove();
  const details = el.querySelector('.chat-activity');
  const list = el.querySelector('.chat-activity-list');
  const count = list ? list.children.length : 0;
  if (details) {
    if (count === 0) details.remove();
    else {
      details.removeAttribute('open');
      details.querySelector('.chat-activity-summary').textContent = t('activities', count);
    }
  }
  if (error && !reply) el.classList.add('chat-error');
  const answerEl = el.querySelector('.chat-answer');
  answerEl.classList.remove('chat-streaming-cursor');
  answerEl.innerHTML = renderMarkdown(reply || error || t('done'));
  if ((turn.mode || el.dataset.mode) === 'translate' && reply) appendCopyButton(answerEl, reply);
  chatScrollToBottom();

  const spoken = stripForSpeech(reply || error || t('done'));
  announce(t('biaReplied', spoken));
  if (accessibilityMode) speak(spoken);
}

function extractJiraKeys(text) {
  const keys = new Set();
  const patterns = [
    /selectedIssue=([A-Z][A-Z0-9]{1,9}-\d+)/g,
    /\/browse\/([A-Z][A-Z0-9]{1,9}-\d+)/g,
    /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) keys.add(m[1]);
  }
  return [...keys].slice(0, 3);
}

async function fetchJiraContext(text) {
  if (!featEnabled('jira')) return '';
  const keys = extractJiraKeys(text);
  if (!keys.length) return '';
  const cfg = await new Promise((r) => chrome.storage.local.get(['jiraUrl', 'jiraToken'], r));
  if (!cfg.jiraUrl || !cfg.jiraToken) return '';
  const parts = [];
  for (const key of keys) {
    appendChatActivity(`🎫 Lendo ${key} no Jira...`);
    const res = await sendMsg('jiraGetIssue', { key }, 20000);
    if (res?.success) {
      parts.push(res.text);
      appendChatActivity(`🎫 ${key} carregado: ${res.summary || ''}`.trim());
    }
    // Chave sem card correspondente (ex.: sigla parecida) falha em silêncio — a Bia segue sem o contexto.
  }
  if (!parts.length) return '';
  return `\n\n[CONTEXTO AUTOMÁTICO — conteúdo dos cards do Jira mencionados, lido pela integração; use como fonte da verdade sem navegar até o Jira]\n${parts.join('\n\n---\n\n')}`;
}

async function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || chatRunning || agentRunning || batchRunning || recording) return;
  const mode = chatMode;
  stopMicListening();
  chatInput.value = '';
  autoGrowChatInput();
  appendChatBubble('user', text, { mode });
  beginAssistantTurn(mode);
  setChatRunning(true);

  // No Tradutor o texto é conteúdo a traduzir — enriquecer com card do Jira só atrapalharia.
  const jiraContext = mode === 'translate' ? '' : await fetchJiraContext(text).catch(() => '');
  const tab = await getActiveTab();
  const ack = await sendMsg('chatMessage', { text: text + jiraContext, tabId: tab?.id, mode }, 20000);
  if (!ack || ack.error || !ack.started) {
    finishAssistantTurn({ error: ack?.error || t('startFail') });
  }
}

function stopChat() {
  if (!chatRunning) return;
  appendChatActivity(t('stopping'));
  chrome.runtime.sendMessage({ action: 'stopAgent' }).catch(() => {});
}

async function resetChat() {
  if (chatRunning) chrome.runtime.sendMessage({ action: 'stopAgent' }).catch(() => {});
  await sendMsg('chatReset', {}, 5000);
  clearChatView();
  setChatRunning(false);
}

function showChatConfirm(id, description) {
  chatPendingConfirmId = id;
  chatConfirmText.textContent = description || t('sensitiveDefault');
  chatConfirm.classList.remove('hidden');
  if (accessibilityMode) speak(chatConfirmText.textContent);
}

function hideChatConfirm() {
  chatPendingConfirmId = null;
  chatConfirm.classList.add('hidden');
}

function answerChatConfirmation(approved) {
  if (!chatPendingConfirmId) return;
  chrome.runtime.sendMessage({ action: 'agentConfirmResponse', id: chatPendingConfirmId, approved });
  hideChatConfirm();
  appendChatActivity(approved ? t('approvedByYou') : t('deniedByYou'));
}

function autoGrowChatInput() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  chatInput.style.overflowY = chatInput.scrollHeight > 120 ? 'auto' : 'hidden';
}

function clearChatView() {
  chatThreadEl.querySelectorAll('.chat-msg').forEach((el) => el.remove());
  chatCurrentTurnEl = null;
  hideChatConfirm();
  chatEmpty.classList.remove('hidden');
}

function openChatHistory() {
  if (chatRunning) return;
  chrome.storage.local.get(['chatConversations'], ({ chatConversations }) => {
    const convos = Array.isArray(chatConversations) ? chatConversations : [];
    chatHistoryListEl.innerHTML = '';
    chatHistoryEmpty.classList.toggle('hidden', convos.length > 0);
    for (const c of convos) {
      const item = document.createElement('div');
      item.className = 'chat-history-item';
      const when = new Date(c.updatedAt || c.createdAt || Date.now())
        .toLocaleString(t('dateLocale'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const count = (c.messages || []).length;
      item.innerHTML = `
        <div class="chat-history-info">
          <div class="chat-history-title">${esc(c.title || t('conversation'))}</div>
          <div class="chat-history-meta">${when} · ${esc(t('messages', count))}</div>
        </div>
        <button class="chat-history-delete" title="${esc(t('deleteConv'))}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>`;
      item.querySelector('.chat-history-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(c.id);
      });
      item.addEventListener('click', () => loadConversation(c.id));
      chatHistoryListEl.appendChild(item);
    }
    chatHistoryOverlay.classList.remove('hidden');
  });
}

async function loadConversation(id) {
  const res = await sendMsg('chatLoad', { id }, 5000);
  if (!res || res.error) {
    chatHistoryOverlay.classList.add('hidden');
    appendChatBubble('assistant', res?.error || t('openConvFail'), { error: true });
    return;
  }
  clearChatView();
  const msgs = res.messages || [];
  for (const m of msgs) renderStoredChatTurn(m);
  if (msgs.length) {
    chatEmpty.classList.add('hidden');
    chatScrollToBottom();
  }
  chatHistoryOverlay.classList.add('hidden');
}

async function deleteConversation(id) {
  const res = await sendMsg('chatDelete', { id }, 5000);
  if (res?.wasActive) clearChatView();
  openChatHistory();
}

function renderStoredChatTurn(m) {
  if (m.role === 'user') { appendChatBubble('user', m.text || '', { mode: m.mode || '' }); return; }
  chatEmpty.classList.add('hidden');
  const el = document.createElement('div');
  el.className = `chat-msg chat-assistant${m.error ? ' chat-error' : ''}`;
  let actsHtml = '';
  if (Array.isArray(m.actions) && m.actions.length) {
    const items = m.actions
      .map((a) => `<div class="chat-activity-item">${a.ok ? '✓' : '✗'} ${esc(a.label || '')}</div>`)
      .join('');
    actsHtml = `<details class="chat-activity"><summary class="chat-activity-summary">${esc(t('activities', m.actions.length))}</summary><div class="chat-activity-list">${items}</div></details>`;
  }
  el.innerHTML = `${actsHtml}<div class="chat-answer">${renderMarkdown(m.text || '')}</div>`;
  if (m.mode === 'translate' && m.text && !m.error) {
    appendCopyButton(el.querySelector('.chat-answer'), m.text);
  }
  chatThreadEl.appendChild(el);
}

function restoreChatThread() {
  chrome.storage.session.get(
    ['chatThread', 'chatRunState', 'runHeartbeat', 'pendingConfirm'],
    ({ chatThread, chatRunState, runHeartbeat, pendingConfirm }) => {
      const msgs = chatThread?.messages || [];
      for (const m of msgs) renderStoredChatTurn(m);
      if (msgs.length) chatScrollToBottom();
      const beat = Math.max(chatRunState?.updatedAt || 0, runHeartbeat?.updatedAt || 0);
      if (chatRunState?.status === 'running' && Date.now() - beat < 180_000) {
        beginAssistantTurn();
        appendChatActivity(t('reopened'));
        setChatRunning(true);
        if (pendingConfirm?.id && Date.now() - (pendingConfirm.createdAt || 0) < 120_000) {
          showChatConfirm(pendingConfirm.id, pendingConfirm.description);
        }
      }
    }
  );
}

function updateRunningStatus(text) {
  runningStatusText.textContent = text;
}

function addLiveStep(text) {
  const el = document.createElement('div');
  el.className = 'live-step';
  el.innerHTML = `<span class="live-step-dot"></span><span>${esc(text)}</span>`;
  liveStepsList.appendChild(el);
  liveStepsList.scrollTop = liveStepsList.scrollHeight;
  while (liveStepsList.children.length > 40) {
    liveStepsList.removeChild(liveStepsList.firstChild);
  }
}

function getActiveTab() {
  return new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs?.[0] || null)));
}

async function executeTest(prompt) {
  const text = prompt || testInput.value.trim();
  if (!text || agentRunning || batchRunning || recording) return;

  const dataset = featEnabled('dataDriven') ? parseDataset(datasetInput.value) : { rows: [] };
  if (dataset.error) { showRunError(`Dataset: ${dataset.error}`); return; }

  const envVars = getActiveEnvVars();
  if (dataset.rows.length > 0) {
    const baseName = text.split('\n')[0].slice(0, 60) || 'Test case';
    const items = expandBatchItems([{ name: baseName, prompt: text }], envVars, dataset.rows);
    const missing = [...new Set(items.flatMap((i) => i.missing))];
    if (missing.length) {
      showRunError(`Variáveis sem valor: ${missing.map((m) => `{{${m}}}`).join(', ')}. Defina no dataset ou no ambiente (⚙️).`);
      return;
    }
    startBatch(items);
    return;
  }

  const substituted = substituteVars(text, envVars);
  if (substituted.missing.length) {
    showRunError(`Variáveis sem valor: ${substituted.missing.map((m) => `{{${m}}}`).join(', ')}. Selecione um ambiente com essas variáveis (⚙️) ou preencha os Dados.`);
    return;
  }
  const finalText = substituted.text;

  runError.classList.add('hidden');
  liveStepsList.innerHTML = '';
  runningStatusText.textContent = 'Iniciando...';
  confirmBar.classList.add('hidden');
  pendingConfirmId = null;
  setRunState('running');
  agentRunning = true;
  userStopped = false;

  const tab = await getActiveTab();
  const ack = await sendMsg('chat', {
    messages: [{ role: 'user', content: finalText }],
    tabId: tab?.id,
    meta: {
      testId: loadedTestId,
      name: text.split('\n')[0].slice(0, 80),
      env: featEnabled('environments') ? (activeEnvName || null) : null,
    },
  }, 20000);

  if (!ack || ack.error || !ack.started) {
    agentRunning = false;
    setRunState('idle');
    showRunError(ack?.error || 'Não foi possível iniciar a execução. Verifique as configurações.');
    return;
  }
  startVideoCapture();
}

async function handleAgentDone(lastRun) {
  if (!lastRun) return;
  agentRunning = false;
  clearTimeout(stopFallbackTimer);
  confirmBar.classList.add('hidden');
  pendingConfirmId = null;

  if (userStopped) {
    userStopped = false;
    discardVideoCapture();
    clearVideoResult();
    chrome.storage.session.set({ runState: { status: 'idle' } });
    setRunState('idle');
    return;
  }

  if (lastRun.error && !lastRun.reply) {
    setRunState('idle');
    showRunError(lastRun.error);
    return;
  }

  lastResult = {
    prompt: lastRun.prompt || '',
    reply:  lastRun.reply  || '',
    status: lastRun.status || null,
    actionsExecuted: lastRun.actionsExecuted || [],
    url:    lastRun.url    || '',
    title:  lastRun.title  || '',
  };

  renderResult(lastResult);
  setRunState('result');
  checkJiraConfig();
  updateZephyrPushArea().then((visible) => {
    if (!visible) return;
    chrome.storage.local.get(['zephyrAutoPush'], (r) => {
      if (r.zephyrAutoPush) pushResultToZephyr();
    });
  });
  presentVideoResult();
  updateVisualDiffArea(lastRun);
}

function rehydrateRunState() {
  chrome.storage.session.get(
    ['runState', 'lastRun', 'runHeartbeat', 'pendingConfirm', 'batchState', 'lastBatch', 'recorderState'],
    ({ runState, lastRun, runHeartbeat, pendingConfirm, batchState, lastBatch, recorderState }) => {
      const showPendingConfirm = () => {
        if (pendingConfirm?.id && Date.now() - (pendingConfirm.createdAt || 0) < 120_000) {
          pendingConfirmId = pendingConfirm.id;
          confirmBarText.textContent = pendingConfirm.description || 'A IA quer executar uma ação sensível.';
          confirmBar.classList.remove('hidden');
        }
      };

      if (batchState?.status === 'running') {
        const lastBeat = Math.max(batchState.updatedAt || 0, runHeartbeat?.updatedAt || 0);
        if (Date.now() - lastBeat < 300_000) {
          batchRunning = true;
          batchStatusText.textContent = `Executando ${Math.min((batchState.done || 0) + 1, batchState.total || 1)} de ${batchState.total || '?'}: ${batchState.current || ''}`;
          batchProgressList.innerHTML = '';
          addBatchProgressLine('🔄 Painel reaberto — lote em andamento');
          showPendingConfirm();
          setRunState('batch');
          return;
        }
        chrome.storage.session.set({ batchState: { status: 'idle' } });
      }

      if (recorderState?.tabId) {
        recording = true;
        recordingTabId = recorderState.tabId;
        recordingStatusText.textContent = 'Gravando… (painel reaberto)';
        setRunState('recording');
        return;
      }

      if (runState?.status === 'running') {
        const lastBeat = Math.max(runState.updatedAt || 0, runHeartbeat?.updatedAt || 0);
        const stale = Date.now() - lastBeat > 180_000;
        if (!stale) {
          agentRunning = true;
          if (runState.prompt) testInput.value = runState.prompt;
          liveStepsList.innerHTML = '';
          runningStatusText.textContent = runHeartbeat?.lastStatus || 'Execução em andamento...';
          addLiveStep('🔄 Painel reaberto — a execução continua em andamento');
          showPendingConfirm();
          setRunState('running');
          return;
        }

        chrome.storage.session.set({ runState: { status: 'idle' } });
        setRunState('idle');
        showRunError('A execução anterior foi interrompida inesperadamente. Execute novamente.');
        return;
      }

      const batchDoneAt = batchState?.status === 'done' && lastBatch ? (lastBatch.finishedAt || 0) : 0;
      const singleDoneAt = runState?.status === 'done' && lastRun ? (lastRun.finishedAt || 0) : 0;
      if (batchDoneAt > singleDoneAt && lastBatch) {
        renderBatchResult(lastBatch);
        return;
      }
      if (runState?.status === 'done' && lastRun) {
        handleAgentDone(lastRun);
      }
    }
  );
}

const EVIDENCE_TYPES = new Set([
  'assert_text', 'assert_url_includes', 'wait_for_text', 'wait_for_selector',
  'assert_network_request', 'extract_text', 'get_attribute', 'get_css',
  'get_errors', 'get_network_requests', 'get_links', 'get_dropdown_options', 'screenshot', 'accessibility_audit',
]);

function detectVerdict(reply, actions, explicitStatus) {
  const statusMap = { passed: 'pass', failed: 'fail', inconclusive: 'warn' };
  let verdict = statusMap[String(explicitStatus || '').toLowerCase()] || null;

  if (!verdict) {
    const raw = reply || '';
    const statusLine = (raw.match(/\*\*\s*status\s*:?\s*\*\*\s*(.+)/i) || raw.match(/\bstatus\s*:\s*(.+)/i));
    if (statusLine) {
      const s = statusLine[1];
      if (/❌|reprovad|failed|not\s+approved|não\s+aprovad/i.test(s)) verdict = 'fail';
      else if (/⚠️|bloquead|blocked|inconclus/i.test(s)) verdict = 'warn';
      else if (/✅|aprovad|passed/i.test(s)) verdict = 'pass';
    }

    if (!verdict) {
      const t = raw.toLowerCase();
      if (/reprovad|falhou|\bfailed\b|não\s+aprovad|not\s+approved/i.test(t)) verdict = 'fail';
      else if (/bloquead|blocked|inconclus/i.test(t)) verdict = 'warn';
      else if (/\baprovad|\bpassou\b|test passed|passou com sucesso/i.test(t)) verdict = 'pass';
    }

    if (!verdict) {
      const relevant = (actions || []).filter(a => a.type !== 'wait' && !a.deferred);
      verdict = (relevant.length && relevant[relevant.length - 1].error) ? 'fail' : 'warn';
    }
  }

  if (verdict === 'pass' && !(actions || []).some(a => a.done && a.type !== 'wait')) verdict = 'warn';

  if (verdict === 'pass' && !(actions || []).some(a => a.done && EVIDENCE_TYPES.has(a.type))) verdict = 'warn';

  return verdict;
}

const STATUS_ICON_SHAPES = {
  pass:  { stroke: '#16a34a', body: '<circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>' },
  fail:  { stroke: '#dc2626', body: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
  warn:  { stroke: '#d97706', body: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
  pause: { stroke: '#d97706', body: '<circle cx="12" cy="12" r="10"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/>' },
};

function statusIcon(kind, size = 14) {
  const shape = STATUS_ICON_SHAPES[kind];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${shape.stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shape.body}</svg>`;
}

function renderResult({ reply, actionsExecuted, status }) {
  const verdict = detectVerdict(reply, actionsExecuted, status);

  const icons = { pass: statusIcon('pass', 22), fail: statusIcon('fail', 22), warn: statusIcon('warn', 22) };
  const labels = { pass: 'Teste Aprovado',   fail: 'Teste Falhou',   warn: 'Execução Concluída' };
  const failedCount = (actionsExecuted || []).filter((a) => a.error && !a.deferred && a.type !== 'wait').length;
  const subs   = { pass: failedCount > 0
                     ? `Objetivo verificado — ${failedCount} ação(ões) falharam no caminho e o agente contornou (veja os passos)`
                     : 'Todos os passos executados com sucesso',
                   fail: 'Um ou mais passos falharam durante a execução',
                   warn: 'Execução concluída — revise os passos abaixo' };

  resultVerdict.className = `result-verdict verdict-${verdict}`;
  resultVerdict.innerHTML = `
    <span class="verdict-icon">${icons[verdict]}</span>
    <div class="verdict-text">
      <strong>${labels[verdict]}</strong>
      <span>${subs[verdict]}</span>
    </div>`;

  renderResultSteps(actionsExecuted);

  if (reply) {
    resultAIText.innerHTML = renderMarkdown(reply);
    resultAIDetails.classList.remove('hidden');
  } else {
    resultAIDetails.classList.add('hidden');
  }
}

function renderResultSteps(actions) {
  resultStepsList.innerHTML = '';
  const filtered = (actions || []).filter(a => a.type !== 'wait');

  if (!filtered.length) {
    resultStepsList.innerHTML = '<p style="padding:16px;color:var(--text-muted);font-size:12px">Nenhuma ação foi registrada.</p>';
    return;
  }

  filtered.forEach(a => {
    const hasErr = !!a.error;

    const isDeferred = !!a.deferred;
    const item   = document.createElement('div');
    item.className = `step-item${hasErr && !isDeferred ? ' step-fail' : ''}`;

    const screenshotSrc = (a.type === 'screenshot' && a.screenshotData)
      ? (a.screenshotData.startsWith('data:') ? a.screenshotData : `data:image/jpeg;base64,${a.screenshotData}`)
      : null;
    const screenshotThumb = screenshotSrc
      ? `<img src="${esc(screenshotSrc)}" class="step-screenshot-thumb" alt="Screenshot" title="Clique para ampliar" data-lightbox="1">`
      : '';

    item.innerHTML = `
      <span class="step-status">${isDeferred ? statusIcon('pause') : hasErr ? statusIcon('fail') : statusIcon('pass')}</span>
      <div class="step-body">
        <span class="step-label">${esc(doneLabel(a))}</span>
        ${screenshotThumb}
        ${hasErr ? `<span class="step-error">${esc(a.error)}</span>` : ''}
      </div>`;
    if (screenshotSrc) {
      item.querySelector('[data-lightbox]')?.addEventListener('click', () => openScreenshotLightbox(screenshotSrc));
    }
    resultStepsList.appendChild(item);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.language) { location.reload(); return; }
  if (changes.environmentsJson || changes.activeEnvironment) loadEnvironments();
  if (changes.jiraUrl || changes.jiraToken || changes.jiraProjectKey) checkJiraConfig();
  if (changes.savedTests) renderLibrary(librarySearch.value);
  if (changes.featureFlags) applyFeatureFlags();
  if (changes.themeMode) loadTheme();
});

function applyFeatureFlags() {
  chrome.storage.local.get(['featureFlags'], (r) => {
    featureFlags = r.featureFlags || {};
    accessBtn.classList.toggle('hidden', !featEnabled('accessibilityButton'));
    recordBtn.classList.toggle('hidden', !featEnabled('recorder'));
    datasetDetails.classList.toggle('hidden', !featEnabled('dataDriven'));
    envSelect.classList.toggle('hidden', !featEnabled('environments'));
    resultPdfBtn.classList.toggle('hidden', !featEnabled('pdfExport'));
    batchPdfBtn.classList.toggle('hidden', !featEnabled('pdfExport'));
    document.body.classList.toggle('feat-no-batch', !featEnabled('batch'));
    const runTabBtn = document.querySelector('.tab-btn[data-tab="run"]');
    const libraryTabBtn = document.querySelector('.tab-btn[data-tab="library"]');
    const debugTabBtn = document.querySelector('.tab-btn[data-tab="debug"]');
    const inspectTabBtn = document.querySelector('.tab-btn[data-tab="inspect"]');
    if (runTabBtn) runTabBtn.classList.toggle('hidden', !featEnabled('runTab'));
    if (libraryTabBtn) libraryTabBtn.classList.toggle('hidden', !featEnabled('libraryTab'));
    if (debugTabBtn) debugTabBtn.classList.toggle('hidden', !featEnabled('debugTab'));
    if (inspectTabBtn) inspectTabBtn.classList.toggle('hidden', !featEnabled('inspectTab'));
    if (!featEnabled('runTab') && document.querySelector('#tab-run.active')) switchTab('chat');
    if (!featEnabled('libraryTab') && document.querySelector('#tab-library.active')) switchTab('chat');
    if (!featEnabled('debugTab') && document.querySelector('#tab-debug.active')) switchTab('chat');
    if (!featEnabled('inspectTab') && document.querySelector('#tab-inspect.active')) switchTab('chat');
    const onlyChat = !featEnabled('runTab') && !featEnabled('libraryTab') && !featEnabled('debugTab') && !featEnabled('inspectTab');
    const tabNav = document.querySelector('.tab-nav');
    if (tabNav) tabNav.classList.toggle('hidden', onlyChat);
    if (onlyChat && !document.querySelector('#tab-chat.active')) switchTab('chat');
    if (!featEnabled('zephyr')) zephyrPushArea.classList.add('hidden');
    suggestBtn.classList.toggle('hidden', !featEnabled('suggestions'));
    if (!featEnabled('videoRecording')) clearVideoResult();
    if (!featEnabled('visualBaseline')) visualDiffArea.classList.add('hidden');
    checkJiraConfig();
  });
}

function loadEnvironments() {
  chrome.storage.local.get(['environmentsJson', 'activeEnvironment'], (r) => {
    const parsed = parseEnvironments(r.environmentsJson || '');
    environments = parsed.environments || {};
    activeEnvName = r.activeEnvironment && environments[r.activeEnvironment] ? r.activeEnvironment : '';
    envSelect.innerHTML = '<option value="">Sem ambiente</option>' +
      Object.keys(environments).map((n) =>
        `<option value="${esc(n)}"${n === activeEnvName ? ' selected' : ''}>${esc(n)}</option>`
      ).join('');
  });
}

function getActiveEnvVars() {
  if (!featEnabled('environments')) return {};
  return activeEnvName && environments[activeEnvName] ? environments[activeEnvName] : {};
}

async function startBatch(items) {
  runError.classList.add('hidden');
  batchProgressList.innerHTML = '';
  batchStatusText.textContent = `Iniciando lote de ${items.length} execução(ões)...`;
  confirmBar.classList.add('hidden');
  pendingConfirmId = null;
  switchTab('run');
  setRunState('batch');
  batchRunning = true;
  userStopped = false;

  const tab = await getActiveTab();
  const ack = await sendMsg('runBatch', {
    items: items.map(({ name, prompt, testId, env }) => ({ name, prompt, testId, env })),
    tabId: tab?.id,
    parallel: parseInt(batchParallelSelect?.value || '1', 10) || 1,
  }, 20000);
  if (!ack || ack.error || !ack.started) {
    batchRunning = false;
    setRunState('idle');
    showRunError(ack?.error || 'Não foi possível iniciar a execução em lote.');
  }
}

function addBatchProgressLine(text) {
  const el = document.createElement('div');
  el.className = 'live-step';
  el.innerHTML = `<span class="live-step-dot"></span><span>${esc(text)}</span>`;
  batchProgressList.appendChild(el);
  batchProgressList.scrollTop = batchProgressList.scrollHeight;
  while (batchProgressList.children.length > 40) {
    batchProgressList.removeChild(batchProgressList.firstChild);
  }
}

const BATCH_STATUS_META = {
  passed:       { icon: '✅', cls: 'bs-pass' },
  failed:       { icon: '❌', cls: 'bs-fail' },
  inconclusive: { icon: '⚠️', cls: 'bs-warn' },
};

function batchItemVerdict(r) {
  if (r.status && BATCH_STATUS_META[r.status]) return r.status;
  const v = detectVerdict(r.reply, r.actionsExecuted, r.status);
  return v === 'pass' ? 'passed' : v === 'fail' ? 'failed' : 'inconclusive';
}

function renderBatchResult(lastBatch) {
  batchRunning = false;
  lastBatchData = lastBatch;
  const results = lastBatch.results || [];
  const counts = { passed: 0, failed: 0, inconclusive: 0 };
  results.forEach((r) => { counts[batchItemVerdict(r)]++; });

  batchSummary.innerHTML = `
    <div class="batch-summary-card">
      <span>${results.length} de ${lastBatch.total || results.length} executados${lastBatch.cancelled ? ' — interrompido' : ''}</span>
      <span class="bs-pass">✅ ${counts.passed}</span>
      <span class="bs-fail">❌ ${counts.failed}</span>
      <span class="bs-warn">⚠️ ${counts.inconclusive}</span>
    </div>`;

  batchResultList.innerHTML = '';
  results.forEach((r) => {
    const meta = BATCH_STATUS_META[batchItemVerdict(r)];
    const item = document.createElement('details');
    item.className = 'batch-item';
    item.innerHTML = `
      <summary>
        <span class="batch-item-status">${meta.icon}</span>
        <span class="batch-item-name" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="batch-item-duration">${r.durationMs ? Math.round(r.durationMs / 1000) + 's' : ''}</span>
      </summary>
      <div class="batch-item-body">${r.error ? `<p class="step-error">${esc(r.error)}</p>` : ''}${renderMarkdown(r.reply || '(sem relatório)')}</div>`;
    batchResultList.appendChild(item);
  });
  setRunState('batchResult');
}

function runTestsBatch(tests) {
  if (agentRunning || batchRunning || recording || !featEnabled('batch')) return;
  const base = tests.map((t) => ({ name: t.name, prompt: t.prompt, testId: t.id }));
  const repeat = parseInt(batchRepeatSelect?.value || '1', 10) || 1;
  const allEnvs = !!batchAllEnvs?.checked && featEnabled('environments') && Object.keys(environments).length > 0;

  let items = [];
  if (allEnvs) {
    for (const [envName, envVars] of Object.entries(environments)) {
      for (const it of expandBatchItems(base, envVars, [])) {
        items.push({ ...it, name: `${it.name} [${envName}]`, env: envName });
      }
    }
  } else {
    items = expandBatchItems(base, getActiveEnvVars(), []).map((it) => ({ ...it, env: activeEnvName || null }));
  }
  if (repeat > 1) {
    items = items.flatMap((it) =>
      Array.from({ length: repeat }, (_, i) => ({ ...it, name: `${it.name} · rodada ${i + 1}` }))
    );
  }

  const missing = [...new Set(items.flatMap((i) => i.missing))];
  if (missing.length) {
    switchTab('run');
    setRunState('idle');
    showRunError(`Variáveis sem valor nos testes selecionados: ${missing.map((m) => `{{${m}}}`).join(', ')}. Selecione um ambiente com essas variáveis (⚙️).`);
    return;
  }
  startBatch(items);
}

async function suggestTestsUI() {
  if (agentRunning || batchRunning || recording || !featEnabled('suggestions')) return;
  suggestBtn.disabled = true;
  suggestBtn.textContent = '💡 Analisando...';
  const tab = await getActiveTab();
  const res = await sendMsg('suggestTests', { tabId: tab?.id }, 150_000);
  suggestBtn.disabled = false;
  suggestBtn.textContent = '💡 Sugerir';
  if (!res || res.error) {
    suggestBox.classList.remove('hidden');
    suggestBox.innerHTML = `<p style="color:#dc2626;margin:0">${esc(res?.error || 'Não foi possível gerar sugestões.')}</p>`;
    setTimeout(() => suggestBox.classList.add('hidden'), 6000);
    return;
  }
  renderSuggestions(res.suggestions);
}

function renderSuggestions(suggestions) {
  suggestBox.classList.remove('hidden');
  suggestBox.innerHTML = `
    <b style="font-size:12px">💡 Test cases sugeridos para esta página</b>
    ${suggestions.map((s, i) => `
      <div class="suggest-item">
        <input type="checkbox" checked data-i="${i}">
        <div>
          <b>${esc(s.name)}</b>
          <details><summary>ver passos</summary><pre>${esc(s.prompt)}</pre></details>
        </div>
      </div>`).join('')}
    <div class="suggest-actions">
      <button id="suggestSaveBtn" class="btn-run-selected">Salvar selecionados</button>
      <button id="suggestCloseBtn" class="btn-suggest">Fechar</button>
    </div>`;

  suggestBox.querySelector('#suggestCloseBtn').addEventListener('click', () => suggestBox.classList.add('hidden'));
  suggestBox.querySelector('#suggestSaveBtn').addEventListener('click', () => {
    const chosen = [...suggestBox.querySelectorAll('input[type=checkbox]:checked')]
      .map((cb) => suggestions[Number(cb.dataset.i)])
      .filter(Boolean);
    if (!chosen.length) { suggestBox.classList.add('hidden'); return; }
    chrome.storage.local.get(['savedTests'], (r) => {
      const tests = r.savedTests || [];
      chosen.forEach((s, i) => {
        tests.unshift({
          id: Date.now() + i,
          name: s.name,
          prompt: s.prompt,
          savedAt: new Date().toLocaleString('pt-BR'),
          tags: ['sugerido'],
          suite: 'Exploratório',
        });
      });
      chrome.storage.local.set({ savedTests: tests }, () => suggestBox.classList.add('hidden'));
    });
  });
}

async function startRecordingUI() {
  if (agentRunning || batchRunning || recording || !featEnabled('recorder')) return;
  const tab = await getActiveTab();
  const res = await sendMsg('recorderStart', { tabId: tab?.id });
  if (!res || res.error) {
    showRunError(res?.error || 'Não foi possível iniciar a gravação. Recarregue a página e tente novamente.');
    return;
  }
  recording = true;
  recordingTabId = res.tabId || tab?.id || null;
  recordedCount = 0;
  recordingStatusText.textContent = 'Gravando… use a página normalmente';
  setRunState('recording');
}

async function stopRecordingUI() {
  const res = await sendMsg('recorderStop', { tabId: recordingTabId });
  recording = false;
  recordingTabId = null;
  const generated = buildTestCaseFromEvents(res?.events || []);
  if (generated) {
    testInput.value = generated;
    runBtn.disabled = false;
  } else {
    showRunError('Nenhuma ação foi capturada durante a gravação.');
  }
  setRunState('idle');
  testInput.focus();
}

function buildTestCaseFromEvents(events) {
  const cleaned = [];
  for (const ev of events || []) {
    if (ev.kind === 'input') {
      const prev = cleaned[cleaned.length - 1];
      if (prev && prev.kind === 'input' && prev.el?.selector === ev.el?.selector) {
        cleaned[cleaned.length - 1] = ev;
        continue;
      }
    }
    cleaned.push(ev);
  }
  const name = (el) => el?.label || el?.text || el?.placeholder || el?.selector || 'elemento';
  const steps = [];
  let lastUrl = null;
  for (const ev of cleaned) {
    if (ev.kind === 'navigate') {
      if (!ev.url || ev.url === lastUrl) continue;
      lastUrl = ev.url;
      steps.push(steps.length === 0 ? `Acesse ${ev.url}` : `Aguarde a página carregar (${ev.url})`);
    } else if (ev.kind === 'click') {
      steps.push(`Clique em "${name(ev.el)}"`);
    } else if (ev.kind === 'input') {
      steps.push(ev.secret ? `Digite {{senha}} no campo "${name(ev.el)}"` : `Digite "${ev.value}" no campo "${name(ev.el)}"`);
    } else if (ev.kind === 'select') {
      steps.push(`Selecione "${ev.value}" em "${name(ev.el)}"`);
    } else if (ev.kind === 'check') {
      steps.push(`${ev.checked ? 'Marque' : 'Desmarque'} "${name(ev.el)}"`);
    } else if (ev.kind === 'enter') {
      steps.push(`Pressione Enter${ev.el ? ` em "${name(ev.el)}"` : ''}`);
    }
  }
  if (steps.length === 0) return '';
  steps.push('Verifique que [DESCREVA AQUI O RESULTADO ESPERADO]');
  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

function openPrintable(title, bodyHtml) {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#111;font-size:13px;line-height:1.55}
h1{font-size:20px}h2{font-size:15px;margin-top:22px}
table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}td,th{border:1px solid #d1d5db;padding:5px 8px;text-align:left;vertical-align:top}
code{background:#f3f4f6;padding:1px 4px;border-radius:3px}pre{background:#f3f4f6;padding:10px;border-radius:6px;overflow:auto;white-space:pre-wrap}
.print-hint{background:#fef3c7;border:1px solid #f59e0b;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:16px}
.status-pass{color:#16a34a;font-weight:700}.status-fail{color:#dc2626;font-weight:700}.status-warn{color:#d97706;font-weight:700}
@media print{.print-hint{display:none}}
</style></head><body>
<div class="print-hint">💡 Use <b>Ctrl/Cmd + P</b> e escolha "Salvar como PDF" no destino.</div>
${bodyHtml}
<hr><p style="color:#6b7280;font-size:11px">Relatório gerado pela Bia — ${esc(new Date().toLocaleString('pt-BR'))}</p>
</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  setTimeout(() => {
    try { if (w) w.print(); } catch (_) {}
    URL.revokeObjectURL(url);
  }, 900);
}

function exportResultPdf() {
  if (!lastResult) return;
  const verdict = detectVerdict(lastResult.reply, lastResult.actionsExecuted, lastResult.status);
  const meta = {
    pass: ['✅ Aprovado', 'status-pass'],
    fail: ['❌ Reprovado', 'status-fail'],
    warn: ['⚠️ Revisar', 'status-warn'],
  }[verdict];
  const steps = (lastResult.actionsExecuted || []).filter((a) => a.type !== 'wait')
    .map((a) => `<tr><td>${a.error && !a.deferred ? '❌' : a.deferred ? '⏸' : '✅'}</td><td>${esc(doneLabel(a))}</td><td>${esc(a.error || '')}</td></tr>`)
    .join('');
  openPrintable('Bia — Relatório de Execução', `
    <h1>Relatório de Execução — Bia</h1>
    <p><span class="${meta[1]}">${meta[0]}</span></p>
    <p><b>URL:</b> ${esc(lastResult.url || '')}<br><b>Página:</b> ${esc(lastResult.title || '')}</p>
    <h2>Test case</h2><pre>${esc(lastResult.prompt || '')}</pre>
    <h2>Passos executados</h2><table><tr><th></th><th>Ação</th><th>Detalhe</th></tr>${steps}</table>
    <h2>Relatório do agente</h2>${renderMarkdown(lastResult.reply || '')}`);
}

function exportBatchJson() {
  if (!lastBatchData) return;
  const payload = {
    tool: 'Bia',
    startedAt: lastBatchData.startedAt || null,
    finishedAt: lastBatchData.finishedAt || null,
    cancelled: !!lastBatchData.cancelled,
    parallel: lastBatchData.parallel || 1,
    summary: (lastBatchData.results || []).reduce((acc, r) => {
      const v = batchItemVerdict(r);
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {}),
    results: (lastBatchData.results || []).map((r) => ({
      name: r.name,
      status: batchItemVerdict(r),
      durationMs: r.durationMs || null,
      env: r.env || null,
      error: r.error || null,
      report: r.reply || '',
    })),
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `bia-qa-lote-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
}

function exportBatchPdf() {
  if (!lastBatchData) return;
  const results = lastBatchData.results || [];
  const rows = results.map((r) => {
    const v = batchItemVerdict(r);
    return `<tr><td>${BATCH_STATUS_META[v].icon}</td><td>${esc(r.name)}</td><td>${r.durationMs ? Math.round(r.durationMs / 1000) + 's' : ''}</td></tr>`;
  }).join('');
  const details = results.map((r) =>
    `<h2>${esc(r.name)}</h2>${r.error ? `<p class="status-fail">${esc(r.error)}</p>` : ''}${renderMarkdown(r.reply || '(sem relatório)')}`
  ).join('<hr>');
  openPrintable('Bia — Relatório do Lote', `
    <h1>Relatório de Execução em Lote — Bia</h1>
    <table><tr><th></th><th>Teste</th><th>Duração</th></tr>${rows}</table>
    ${details}`);
}

function renderLibrary(filter = '') {
  chrome.storage.local.get(['savedTests', 'runHistory', 'zephyrToken', 'zephyrProjectKey'], (r) => {
    const zephyrReady = featEnabled('zephyr') && !!(r.zephyrToken && r.zephyrProjectKey);
    const flakyMap = computeFlakyMap(r.runHistory || []);
    const all = r.savedTests || [];
    const f = (filter || '').toLowerCase();
    const tests = all.filter((t) =>
      !f ||
      t.name.toLowerCase().includes(f) ||
      (t.suite || '').toLowerCase().includes(f) ||
      (t.tags || []).some((tag) => tag.toLowerCase().includes(f))
    );

    selectedTests = new Set([...selectedTests].filter((id) => all.some((t) => t.id === id)));
    updateLibraryBatchBar();
    libraryList.innerHTML = '';

    if (!tests.length) {
      libraryEmpty.classList.remove('hidden');
      libraryList.classList.add('hidden');
      return;
    }

    libraryEmpty.classList.add('hidden');
    libraryList.classList.remove('hidden');

    const groups = new Map();
    tests.forEach((t) => {
      const key = t.suite || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    });
    const ordered = [...groups.entries()].sort((a, b) => {
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return a[0].localeCompare(b[0]);
    });

    for (const [suite, items] of ordered) {
      if (suite || groups.size > 1) {
        const header = document.createElement('div');
        header.className = 'library-suite-header';
        header.innerHTML = `<span>${esc(suite || 'Sem suite')}</span>` +
          (suite ? `<button class="suite-run-btn" title="Executar todos os testes desta suite em sequência">▶ Executar suite (${items.length})</button>` : '');
        if (suite) header.querySelector('.suite-run-btn').addEventListener('click', () => runTestsBatch(items));
        libraryList.appendChild(header);
      }
      items.forEach((t) => libraryList.appendChild(buildLibraryItem(t, filter, flakyMap, zephyrReady)));
    }
  });
}

function updateLibraryBatchBar() {
  const n = selectedTests.size;
  libraryBatchBar.classList.toggle('hidden', n === 0);
  librarySelCount.textContent = `${n} selecionado${n === 1 ? '' : 's'}`;
}

function buildLibraryItem(t, filter, flakyMap, zephyrReady) {
  const item = document.createElement('div');
  item.className = 'library-item';
  const flakyInfo = flakyMap && flakyMap.get(t.id);
  const flakyChip = flakyInfo
    ? `<span class="tag-chip tag-flaky" title="Resultados inconsistentes nas últimas execuções (${flakyInfo.fails} falha(s) em ${flakyInfo.total})">⚡ flaky</span>`
    : '';
  const zephyrChip = t.zephyrKey
    ? `<span class="tag-chip tag-zephyr" title="Test case criado no Zephyr">⬆ ${esc(t.zephyrKey)}</span>`
    : '';
  const tagsHtml = flakyChip + zephyrChip + (t.tags || [])
    .filter((tag) => !(t.zephyrKey && tag === 'zephyr'))
    .map((tag) => `<span class="tag-chip">${esc(tag)}</span>`).join('');
  const zephyrBtn = (!t.zephyrKey && zephyrReady)
    ? `<button class="lib-zephyr-btn" data-id="${t.id}" title="Enviar ao Zephyr (criar test case no Jira)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><polyline points="6 10 12 4 18 10"/><path d="M4 20h16"/></svg>
      </button>`
    : '';
  item.innerHTML = `
    <input type="checkbox" class="lib-check" ${selectedTests.has(t.id) ? 'checked' : ''} title="Selecionar para execução em lote">
    <div class="library-item-info">
      <div class="library-item-name" title="${esc(t.prompt)}">${esc(t.name)}</div>
      <div class="library-item-meta">${tagsHtml}${esc(t.savedAt || '')}</div>
    </div>
    <div class="library-item-actions">
      ${zephyrBtn}
      <button class="lib-run-btn" data-id="${t.id}" title="Abrir na aba Executar (sem rodar)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button class="lib-delete-btn" data-id="${t.id}" title="Excluir">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;

  const zBtn = item.querySelector('.lib-zephyr-btn');
  if (zBtn) {
    zBtn.addEventListener('click', async () => {
      zBtn.disabled = true;
      zBtn.textContent = '…';
      const res = await sendMsg('zephyrExport', { testId: t.id });
      if (res?.success) return; // o background grava zephyrKey em savedTests e a lista re-renderiza sozinha
      zBtn.disabled = false;
      zBtn.textContent = '!';
      zBtn.classList.add('lib-zephyr-btn-error');
      zBtn.title = res?.error || 'Falha ao enviar ao Zephyr';
    });
  }

  item.querySelector('.lib-check').addEventListener('change', (e) => {
    if (e.target.checked) selectedTests.add(t.id);
    else selectedTests.delete(t.id);
    updateLibraryBatchBar();
  });

  item.querySelector('.lib-run-btn').addEventListener('click', () => {
    testInput.value = t.prompt;
    loadedZephyrKey = t.zephyrKey || null;
    loadedTestId = t.id;
    runBtn.disabled = false;
    switchTab('run');
    if (!agentRunning && !batchRunning) {
      setRunState('idle');
      testInput.focus();
    }
  });

  item.querySelector('.lib-delete-btn').addEventListener('click', () => {
    chrome.storage.local.get(['savedTests'], (r2) => {
      const updated = (r2.savedTests || []).filter((x) => x.id !== t.id);
      selectedTests.delete(t.id);
      chrome.storage.local.set({ savedTests: updated }, () => renderLibrary(filter));
    });
  });

  return item;
}

function saveCurrentTest() {
  if (!lastResult) return;

  document.getElementById('saveInlineForm')?.remove();

  resultSaveBtn.classList.add('hidden');

  const form = document.createElement('div');
  form.id = 'saveInlineForm';
  form.className = 'save-inline-form';
  form.style.display = 'block';
  form.innerHTML = `
    <div class="save-meta-row" style="margin-bottom:6px">
      <input type="text" id="saveNameInput" class="save-name-input"
        value="${esc(lastResult.prompt.substring(0, 80))}"
        placeholder="Nome do teste" maxlength="120">
      <button id="saveConfirmBtn" class="save-confirm-btn" title="Confirmar">✓</button>
      <button id="saveCancelBtn" class="save-cancel-btn" title="Cancelar">✕</button>
    </div>
    <div class="save-meta-row">
      <input type="text" id="saveTagsInput" placeholder="tags, separadas por vírgula" maxlength="120">
      <input type="text" id="saveSuiteInput" placeholder="suite (opcional)" maxlength="60">
    </div>
    <label class="save-zephyr-row hidden" id="saveZephyrRow">
      <input type="checkbox" id="saveZephyrCheck"> Enviar ao Zephyr (criar test case no Jira)
    </label>`;

  const resultRow = document.querySelector('#runResult .result-row');
  resultRow.parentElement.insertBefore(form, resultRow);

  chrome.storage.local.get(['zephyrToken', 'zephyrProjectKey', 'zephyrAutoExport'], (cfg) => {
    if (featEnabled('zephyr') && cfg.zephyrToken && cfg.zephyrProjectKey) {
      form.querySelector('#saveZephyrRow').classList.remove('hidden');
      form.querySelector('#saveZephyrCheck').checked = !!cfg.zephyrAutoExport;
    }
  });

  const nameInput = form.querySelector('#saveNameInput');
  nameInput.focus();
  nameInput.select();

  function cleanup() {
    form.remove();
    resultSaveBtn.classList.remove('hidden');
  }

  function doSave() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const exportToZephyr = !form.querySelector('#saveZephyrRow').classList.contains('hidden')
      && form.querySelector('#saveZephyrCheck').checked;
    chrome.storage.local.get(['savedTests'], (r) => {
      const tests = r.savedTests || [];
      const tags = (form.querySelector('#saveTagsInput')?.value || '')
        .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
      const suite = (form.querySelector('#saveSuiteInput')?.value || '').trim();
      const id = Date.now();
      tests.unshift({
        id,
        name,
        prompt: lastResult.prompt,
        savedAt: new Date().toLocaleString('pt-BR'),
        tags,
        suite,
      });
      chrome.storage.local.set({ savedTests: tests, zephyrAutoExport: exportToZephyr }, async () => {
        cleanup();
        resultSaveBtn.disabled = true;
        if (exportToZephyr) {
          resultSaveBtn.textContent = '✓ Salvo — enviando ao Zephyr…';
          const res = await sendMsg('zephyrExport', { testId: id });
          resultSaveBtn.textContent = res?.success ? `✓ Salvo + Zephyr ${res.key}` : '✓ Salvo (falha no Zephyr)';
          if (!res?.success) resultSaveBtn.title = res?.error || 'Falha ao enviar ao Zephyr';
        } else {
          resultSaveBtn.innerHTML = '✓ Salvo!';
        }
        setTimeout(() => {
          resultSaveBtn.disabled = false;
          resultSaveBtn.title = '';
          resultSaveBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Salvar Teste`;
        }, exportToZephyr ? 5000 : 3000);
      });
    });
  }

  form.querySelector('#saveConfirmBtn').addEventListener('click', doSave);
  form.querySelector('#saveCancelBtn').addEventListener('click', cleanup);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') cleanup();
  });
}

function setDebugState(state) {
  debugIdle.classList.toggle('hidden',    state !== 'idle');
  debugRunning.classList.toggle('hidden', state !== 'running');
  debugResult.classList.toggle('hidden',  state !== 'result');
}

function showDebugError(msg) {
  debugIdle.querySelector('.debug-error-msg')?.remove();
  const el = document.createElement('div');
  el.className = 'debug-error-msg';
  el.textContent = msg;
  debugIdle.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

async function runDebug() {
  debugIdle.querySelector('.debug-error-msg')?.remove();
  setDebugState('running');

  try {
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const tab  = tabs?.find(t => !isRestrictedUrl(t.url));

    if (!tab) {
      setDebugState('idle');
      showDebugError('Nenhuma aba válida ativa. Abra uma página web e tente novamente.');
      return;
    }

    const result = await new Promise(r =>
      chrome.runtime.sendMessage({ action: 'qaDebug', tabId: tab.id }, (res) => {
        if (chrome.runtime.lastError) {
          r({ success: false, error: chrome.runtime.lastError.message });
        } else {
          r(res);
        }
      })
    );

    if (!result?.success) {
      setDebugState('idle');
      const raw = result?.error || '';
      const msg = raw.includes('Receiving end does not exist')
        ? 'Content script não encontrado — recarregue a página e tente novamente.'
        : (raw || 'Não foi possível coletar dados. Verifique se a aba está carregada.');
      showDebugError(msg);
      return;
    }

    renderDebugReport(result.data);
    setDebugState('result');
  } catch (e) {
    setDebugState('idle');
    showDebugError(e.message || 'Erro inesperado ao analisar a página.');
  }
}

function renderDebugReport(d) {
  const md = buildQAMarkdown(d);

  debugResult.innerHTML = '';

  const rerunBar = document.createElement('div');
  rerunBar.className = 'debug-rerun-bar';
  rerunBar.innerHTML = `
    <span>Relatório de <strong>${esc(d.page.domain || d.page.url)}</strong> — ${esc(d.page.timestamp || new Date().toLocaleString('pt-BR'))}</span>
    <button class="btn-debug-rerun" id="debugRerunBtn">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
      Reanalisar
    </button>`;
  debugResult.appendChild(rerunBar);

  const report = document.createElement('div');
  report.className = 'qa-report-bubble';
  debugResult.appendChild(report);

  buildQAReportHTML(d, report, md);

  rerunBar.querySelector('#debugRerunBtn').addEventListener('click', () => {
    setDebugState('idle');
  });
}

async function toggleInspect() {
  const tab = await getActiveTab();
  const result = await sendMsg(inspecting ? 'stopInspect' : 'startInspect', { tabId: tab?.id });
  if (result?.error) {
    inspectEmpty.innerHTML = `<p style="color:#dc2626">${esc(result.error)}</p>`;
    inspectEmpty.classList.remove('hidden');
    return;
  }
  inspecting = !inspecting;
  inspectToggleLabel.textContent = inspecting ? 'Parar' : 'Inspecionar';
  inspectToggleBtn.classList.toggle('inspecting', inspecting);
  if (inspecting) {
    inspectEmpty.innerHTML = '<p>Modo inspetor ativo — clique em um elemento na página.</p>';
    inspectEmpty.classList.remove('hidden');
  }
}

function renderInspectedElement(el) {
  inspectEmpty.classList.add('hidden');
  inspectedCard.classList.remove('hidden');
  inspectedSelector.textContent = el.selector || '';

  const rows = [
    ['Tag', el.tag],
    ['ID', el.id],
    ['Texto', el.text],
    ['data-testid', el.dataTestid],
    ['Role', el.role],
    ['aria-label', el.ariaLabel],
    ['Classes', el.className],
    ['XPath', el.xpath],
    ['Posição', el.rect ? `x:${el.rect.x} y:${el.rect.y} ${el.rect.w}×${el.rect.h}` : ''],
  ].filter(([, v]) => v);

  inspectedDetails.innerHTML = rows.map(([k, v]) =>
    `<span class="inspected-key">${esc(k)}</span><span class="inspected-value">${esc(String(v).slice(0, 200))}</span>`
  ).join('');
}

function copyInspectedSelector() {
  const sel = inspectedSelector.textContent;
  if (!sel) return;
  navigator.clipboard.writeText(sel).then(() => {
    copySelectorBtn.textContent = '✓';
    setTimeout(() => {
      copySelectorBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    }, 1500);
  });
}

async function refreshPageContext() {
  contextContent.innerHTML = '<p class="inspect-empty-inline">Capturando contexto...</p>';
  const tab = await getActiveTab();
  const result = await sendMsg('getPageContext', { tabId: tab?.id });

  if (!result?.success || !result.context) {
    contextContent.innerHTML = `<p class="inspect-empty-inline" style="color:#dc2626">${esc(result?.error || 'Não foi possível capturar o contexto. Recarregue a página.')}</p>`;
    return;
  }

  const c = result.context;
  const consoleHtml = (c.recentConsole || []).length
    ? c.recentConsole.map((e) =>
        `<div class="ctx-log-line ${e.level === 'error' ? 'ctx-err' : ''}">[${esc(e.level || 'log')}] ${esc((e.message || '').slice(0, 160))}</div>`
      ).join('')
    : '<div class="ctx-log-line ctx-ok">Nenhum log capturado</div>';

  const networkHtml = (c.recentNetwork || []).length
    ? c.recentNetwork.map((n) => {
        const failed = !n.ok || (n.status && n.status >= 400);
        return `<div class="ctx-log-line ${failed ? 'ctx-err' : ''}">${esc(n.method || '')} ${esc((n.url || '').slice(0, 90))} → ${esc(String(n.status ?? n.error ?? '?'))} <span class="ctx-dim">${esc(n.duration || '')}</span></div>`;
      }).join('')
    : '<div class="ctx-log-line ctx-ok">Nenhuma chamada de rede capturada</div>';

  contextContent.innerHTML = `
    <div class="ctx-kv">
      <span class="inspected-key">URL</span><span class="inspected-value">${esc(c.url)}</span>
      <span class="inspected-key">Título</span><span class="inspected-value">${esc(c.title)}</span>
      <span class="inspected-key">Elementos</span><span class="inspected-value">${c.elementCount} interativos detectados</span>
      <span class="inspected-key">Erros console</span><span class="inspected-value ${c.consoleErrors > 0 ? 'ctx-err' : 'ctx-ok'}">${c.consoleErrors}</span>
      <span class="inspected-key">Falhas rede</span><span class="inspected-value ${c.networkErrors > 0 ? 'ctx-err' : 'ctx-ok'}">${c.networkErrors}</span>
      <span class="inspected-key">Capturado</span><span class="inspected-value">${esc(new Date(c.capturedAt).toLocaleTimeString('pt-BR'))}</span>
    </div>
    <p class="ctx-section-title">Console recente</p>
    <div class="ctx-log-box">${consoleHtml}</div>
    <p class="ctx-section-title">Rede recente</p>
    <div class="ctx-log-box">${networkHtml}</div>`;
}

let videoRecorder = null;
let videoStream = null;
let videoChunks = [];
let videoCanvas = null;
let videoCtx = null;
let videoFrameCount = 0;
let lastVideoUrl = null;
let videoLastImage = null;
let videoHeartbeat = null;
let videoStartTs = 0;
let videoStatusText = '';

function compositeVideoFrame() {
  if (!videoCtx || !videoCanvas) return;
  videoCtx.fillStyle = '#111';
  videoCtx.fillRect(0, 0, videoCanvas.width, videoCanvas.height);
  if (videoLastImage) {
    const scale = Math.min(videoCanvas.width / videoLastImage.width, videoCanvas.height / videoLastImage.height);
    const w = videoLastImage.width * scale;
    const h = videoLastImage.height * scale;
    videoCtx.drawImage(videoLastImage, (videoCanvas.width - w) / 2, (videoCanvas.height - h) / 2, w, h);
  } else {
    videoCtx.fillStyle = '#888';
    videoCtx.font = '20px sans-serif';
    videoCtx.textAlign = 'center';
    videoCtx.fillText('Bia — aguardando a página...', videoCanvas.width / 2, videoCanvas.height / 2);
    videoCtx.textAlign = 'left';
  }
  const elapsed = Math.max(0, Math.round((Date.now() - videoStartTs) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const barH = 36;
  videoCtx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  videoCtx.fillRect(0, videoCanvas.height - barH, videoCanvas.width, barH);
  videoCtx.fillStyle = '#fa5a50';
  videoCtx.font = 'bold 15px sans-serif';
  videoCtx.fillText(`⏱ ${mm}:${ss}`, 14, videoCanvas.height - 12);
  videoCtx.fillStyle = '#fff';
  videoCtx.font = '14px sans-serif';
  videoCtx.fillText((videoStatusText || '').slice(0, 110), 92, videoCanvas.height - 12);
}

function startVideoCapture() {
  if (!featEnabled('videoRecording') || typeof MediaRecorder === 'undefined') return;
  discardVideoCapture();
  videoCanvas = document.createElement('canvas');
  videoCanvas.width = 1280;
  videoCanvas.height = 800;
  videoCtx = videoCanvas.getContext('2d');
  videoLastImage = null;
  videoStatusText = 'Iniciando...';
  videoStartTs = Date.now();
  compositeVideoFrame();
  videoChunks = [];
  videoFrameCount = 0;
  try {
    videoStream = videoCanvas.captureStream(8);
    videoRecorder = new MediaRecorder(videoStream, { mimeType: 'video/webm', videoBitsPerSecond: 2_500_000 });
  } catch (_) {
    videoRecorder = null;
    videoStream = null;
    return;
  }
  videoRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) videoChunks.push(e.data); };
  videoRecorder.start(1000);
  videoHeartbeat = setInterval(compositeVideoFrame, 400);
}

function drawVideoFrame(base64) {
  if (!videoCtx || !videoRecorder) return;
  const img = new Image();
  img.onload = () => {
    if (!videoCtx) return;
    videoLastImage = img;
    videoFrameCount++;
    compositeVideoFrame();
  };
  img.src = 'data:image/jpeg;base64,' + base64;
}

function stopVideoStream() {
  if (videoStream) { try { videoStream.getTracks().forEach((t) => t.stop()); } catch (_) {} }
  videoStream = null;
}

function stopVideoCapture() {
  return new Promise((resolve) => {
    const rec = videoRecorder;
    videoRecorder = null;
    clearInterval(videoHeartbeat);
    videoHeartbeat = null;
    const durationMs = Math.max(0, Date.now() - videoStartTs);
    if (!rec || rec.state === 'inactive') { stopVideoStream(); videoCtx = null; videoCanvas = null; videoLastImage = null; resolve(null); return; }
    rec.onstop = () => {
      stopVideoStream();
      const raw = videoFrameCount > 0 && videoChunks.length > 0 ? new Blob(videoChunks, { type: 'video/webm' }) : null;
      videoCtx = null;
      videoCanvas = null;
      videoLastImage = null;
      videoChunks = [];
      if (raw && typeof window.ysFixWebmDuration === 'function') {
        try {
          window.ysFixWebmDuration(raw, durationMs, (fixed) => resolve(fixed || raw), { logger: false });
          return;
        } catch (_) {}
      }
      resolve(raw);
    };
    try { rec.stop(); } catch (_) { stopVideoStream(); videoCtx = null; videoCanvas = null; videoLastImage = null; resolve(null); }
  });
}

function discardVideoCapture() {
  const rec = videoRecorder;
  videoRecorder = null;
  clearInterval(videoHeartbeat);
  videoHeartbeat = null;
  if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (_) {} }
  stopVideoStream();
  videoCtx = null;
  videoCanvas = null;
  videoLastImage = null;
  videoChunks = [];
  videoFrameCount = 0;
}

function clearVideoResult() {
  if (lastVideoUrl) { URL.revokeObjectURL(lastVideoUrl); lastVideoUrl = null; }
  runVideo.removeAttribute('src');
  videoDetails.classList.add('hidden');
  videoDetails.removeAttribute('open');
}

function sanitizeDownloadName(name) {
  return sanitizePathSegment(name) || 'arquivo';
}

function saveDownload(url, filename) {
  return new Promise((resolve) => {
    const clean = sanitizeDownloadName(filename);
    chrome.storage.local.get(['downloadFolder', 'downloadAskWhere'], (r) => {
      const folder = sanitizePathSegment(r.downloadFolder);
      const full = folder ? `${folder}/${clean}` : clean;
      if (!chrome.downloads?.download) {
        const a = document.createElement('a');
        a.href = url; a.download = clean; a.click();
        resolve(true);
        return;
      }
      chrome.downloads.download(
        { url, filename: full, saveAs: r.downloadAskWhere === true },
        () => {
          if (chrome.runtime.lastError) {
            const a = document.createElement('a');
            a.href = url; a.download = clean; a.click();
          }
          resolve(true);
        }
      );
    });
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  saveDownload(url, filename).then(() => setTimeout(() => URL.revokeObjectURL(url), 60_000));
}

function downloadVideoFile() {
  if (!lastVideoUrl) return;
  saveDownload(lastVideoUrl, `bia-qa-execucao-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`);
}

async function presentVideoResult() {
  const blob = await stopVideoCapture();
  clearVideoResult();
  if (!blob || !featEnabled('videoRecording')) return;
  lastVideoUrl = URL.createObjectURL(blob);
  runVideo.src = lastVideoUrl;
  videoDetails.classList.remove('hidden');
  chrome.storage.local.get(['videoAutoSave'], (r) => {
    if (r.videoAutoSave === true) downloadVideoFile();
  });
}

const BASELINE_LIMIT = 15;

function loadB64Image(b64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = 'data:image/jpeg;base64,' + b64;
  });
}

async function computeImageDiff(b64Baseline, b64Current) {
  const [a, b] = await Promise.all([loadB64Image(b64Baseline), loadB64Image(b64Current)]);
  const w = Math.min(a.width, b.width, 900);
  const h = Math.min(a.height, b.height, 700);
  const draw = (img) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  };
  const ca = draw(a);
  const cb = draw(b);
  const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
  const db = cb.getContext('2d').getImageData(0, 0, w, h).data;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = w; diffCanvas.height = h;
  const dctx = diffCanvas.getContext('2d');
  dctx.globalAlpha = 0.35;
  dctx.drawImage(cb, 0, 0);
  dctx.globalAlpha = 1;
  const out = dctx.getImageData(0, 0, w, h);
  let diffCount = 0;
  const TOL = 26;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.abs(da[i] - db[i]) > TOL || Math.abs(da[i + 1] - db[i + 1]) > TOL || Math.abs(da[i + 2] - db[i + 2]) > TOL) {
      diffCount++;
      out.data[i] = 220; out.data[i + 1] = 30; out.data[i + 2] = 30; out.data[i + 3] = 255;
    }
  }
  dctx.putImageData(out, 0, 0);
  return { pct: (diffCount / (w * h)) * 100, diffCanvas, current: cb };
}

function saveVisualBaseline(testId, data, done) {
  chrome.storage.local.get(['visualBaselines'], (r) => {
    const baselines = { ...(r.visualBaselines || {}) };
    baselines[testId] = { data, savedAt: Date.now() };
    const ids = Object.keys(baselines);
    if (ids.length > BASELINE_LIMIT) {
      ids.sort((x, y) => (baselines[x].savedAt || 0) - (baselines[y].savedAt || 0));
      for (const id of ids.slice(0, ids.length - BASELINE_LIMIT)) delete baselines[id];
    }
    chrome.storage.local.set({ visualBaselines: baselines }, done);
  });
}

async function updateVisualDiffArea(lastRun) {
  visualDiffArea.classList.add('hidden');
  visualDiffArea.innerHTML = '';
  if (!featEnabled('visualBaseline') || !loadedTestId || !lastRun?.tabId) return;

  const shotRes = await sendMsg('captureTabScreenshot', { tabId: lastRun.tabId });
  const current = shotRes?.data || null;
  if (!current) return;

  const store = await new Promise((r) => chrome.storage.local.get(['visualBaselines'], r));
  const baseline = (store.visualBaselines || {})[loadedTestId];
  const testId = loadedTestId;

  if (!baseline) {
    visualDiffArea.innerHTML = `
      <span>🖼 Regressão visual: este teste ainda não tem baseline.</span>
      <div class="vd-actions"><button id="vdSetBtn" class="btn-outline">Definir screenshot atual como baseline</button></div>`;
    visualDiffArea.classList.remove('hidden');
    visualDiffArea.querySelector('#vdSetBtn').addEventListener('click', (e) => {
      saveVisualBaseline(testId, current, () => {
        e.target.textContent = '✓ Baseline salvo';
        e.target.disabled = true;
      });
    });
    return;
  }

  let diff;
  try {
    diff = await computeImageDiff(baseline.data, current);
  } catch (_) {
    return;
  }
  const pct = diff.pct;
  const cls = pct < 1 ? 'vd-pct-ok' : pct < 5 ? 'vd-pct-warn' : 'vd-pct-bad';
  visualDiffArea.innerHTML = `
    <span>🖼 Regressão visual: <span class="${cls}">Δ ${pct.toFixed(1)}%</span> vs baseline de ${esc(new Date(baseline.savedAt).toLocaleDateString('pt-BR'))}</span>
    <div class="vd-row">
      <figure><img src="data:image/jpeg;base64,${baseline.data}" alt="baseline"><figcaption>baseline</figcaption></figure>
      <figure><img src="data:image/jpeg;base64,${current}" alt="atual"><figcaption>atual</figcaption></figure>
      <figure><figcaption>diferenças</figcaption></figure>
    </div>
    <div class="vd-actions"><button id="vdUpdateBtn" class="btn-outline">Atualizar baseline</button></div>`;
  visualDiffArea.querySelectorAll('figure')[2].prepend(diff.diffCanvas);
  visualDiffArea.classList.remove('hidden');
  visualDiffArea.querySelector('#vdUpdateBtn').addEventListener('click', (e) => {
    saveVisualBaseline(testId, current, () => {
      e.target.textContent = '✓ Baseline atualizado';
      e.target.disabled = true;
    });
  });
}

function resetZephyrPushBtn() {
  zephyrPushBtn.disabled = false;
  zephyrPushBtn.title = '';
  zephyrPushBtn.textContent = 'Enviar ao Zephyr';
}

async function updateZephyrPushArea() {
  // Com zephyrKey envia direto; sem chave mas vindo da biblioteca (loadedTestId),
  // o push cria o test case no Zephyr primeiro e depois envia o resultado.
  if ((!loadedZephyrKey && !loadedTestId) || !featEnabled('zephyr')) { zephyrPushArea.classList.add('hidden'); return false; }
  const cfg = await new Promise((r) => chrome.storage.local.get(['zephyrToken', 'zephyrProjectKey', 'zephyrAutoPush'], r));
  if (!cfg.zephyrToken || !cfg.zephyrProjectKey) { zephyrPushArea.classList.add('hidden'); return false; }
  zephyrPushKey.textContent = loadedZephyrKey || 'novo test case';
  const autoCheck = $('zephyrAutoPushCheck');
  if (autoCheck) autoCheck.checked = !!cfg.zephyrAutoPush;
  resetZephyrPushBtn();
  zephyrPushArea.classList.remove('hidden');
  zephyrCycleSelect.innerHTML = '<option value="">Carregando ciclos...</option>';
  const res = await sendMsg('zephyrListCycles');
  zephyrCycleSelect.innerHTML = '<option value="">Sem ciclo</option>' +
    ((res && res.cycles) || []).map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('');
  return true;
}

async function pushResultToZephyr() {
  if (!lastResult || (!loadedZephyrKey && !loadedTestId)) return;
  const verdict = detectVerdict(lastResult.reply, lastResult.actionsExecuted, lastResult.status);
  const statusName = verdict === 'pass' ? 'Pass' : verdict === 'fail' ? 'Fail' : 'Blocked';
  zephyrPushBtn.disabled = true;

  let key = loadedZephyrKey;
  if (!key) {
    zephyrPushBtn.textContent = 'Criando test case...';
    const created = await sendMsg('zephyrExport', { testId: loadedTestId });
    if (!created || !created.success) {
      zephyrPushBtn.disabled = false;
      zephyrPushBtn.textContent = '⚠️ Erro — tentar de novo';
      zephyrPushBtn.title = (created && created.error) || 'Falha ao criar o test case no Zephyr';
      return;
    }
    key = created.key;
    loadedZephyrKey = key;
    zephyrPushKey.textContent = key;
  }

  zephyrPushBtn.textContent = 'Enviando...';
  const comment = `Execução automática Bia — ${statusName}\nURL: ${lastResult.url || ''}\n\n${(lastResult.reply || '').slice(0, 5000)}`;
  const res = await sendMsg('zephyrPushResult', {
    testCaseKey: key,
    testCycleKey: zephyrCycleSelect.value || null,
    statusName,
    comment,
  });
  if (res && res.success) {
    zephyrPushBtn.textContent = `✓ Enviado ao Zephyr (${key})`;
  } else {
    zephyrPushBtn.disabled = false;
    zephyrPushBtn.textContent = '⚠️ Erro — tentar de novo';
    zephyrPushBtn.title = (res && res.error) || 'Erro desconhecido';
  }
}

function checkJiraConfig() {
  chrome.storage.local.get(['jiraUrl', 'jiraEmail', 'jiraToken', 'jiraProjectKey'], (r) => {
    const ok = featEnabled('jira') && !!(r.jiraUrl && r.jiraToken && r.jiraProjectKey);
    resultJiraBtn.classList.toggle('hidden', !ok);
    const bugJiraBtn = $('bugJiraBtn');
    if (bugJiraBtn) bugJiraBtn.classList.toggle('hidden', !ok);
  });
}

async function openBugReportFromResult() {
  if (!lastResult) return;

  const steps  = buildStepsFromActions(lastResult.actionsExecuted);
  const actual = lastResult.reply
    ? lastResult.reply.replace(/<[^>]+>/g, '').substring(0, 800)
    : '';

  $('bugTitle').value    = '';
  $('bugUrl').value      = lastResult.url || '';
  $('bugSteps').value    = steps;
  $('bugActual').value   = actual;
  $('bugExpected').value = '';
  $('bugEnv').value      = 'Staging';
  $('bugSeverity').value = 'Média';

  resetJiraBtn($('bugJiraBtn'));
  document.querySelector('.jira-issue-link')?.remove();

  bugScreenshot = null;
  renderScreenshotArea(null, true);
  bugReportOverlay.classList.remove('hidden');
  checkJiraConfig();

  const res = await sendMsg('captureScreenshot');
  bugScreenshot = res?.data || null;
  renderScreenshotArea(bugScreenshot, false);
}

function openScreenshotLightbox(dataUrl) {
  const lb = document.createElement('div');
  lb.className = 'screenshot-lightbox';
  lb.innerHTML = `
    <img src="${esc(dataUrl)}" alt="Screenshot">
    <button class="screenshot-lightbox-close" title="Fechar">✕</button>`;
  lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('screenshot-lightbox-close')) lb.remove(); });
  document.body.appendChild(lb);
}

function renderScreenshotArea(dataUrl, loading) {
  document.getElementById('bugScreenshotArea')?.remove();

  const area = document.createElement('div');
  area.id = 'bugScreenshotArea';
  area.className = 'bug-screenshot-area';

  if (loading) {
    area.innerHTML = `<span class="bug-screenshot-label">📸 Capturando tela...</span>`;
  } else if (dataUrl) {
    area.innerHTML = `
      <span class="bug-screenshot-label">📸 Screenshot capturada — clique para ampliar</span>
      <img src="${esc(dataUrl)}" class="bug-screenshot-thumb" alt="Screenshot">`;
    area.querySelector('img').addEventListener('click', () => openScreenshotLightbox(dataUrl));
  } else {
    area.innerHTML = `<span class="bug-screenshot-label" style="color:var(--text-muted)">⚠️ Não foi possível capturar a tela</span>`;
  }

  const body = document.querySelector('.modal-body');
  if (body) body.insertBefore(area, body.firstChild);
}

async function createBugOnJira() {
  const btn      = $('bugJiraBtn');
  const title    = $('bugTitle').value.trim();
  const steps    = $('bugSteps').value.trim();
  const actual   = $('bugActual').value.trim();
  const expected = $('bugExpected').value.trim();
  const env      = $('bugEnv').value;
  const severity = $('bugSeverity').value;
  const url      = $('bugUrl').value.trim();

  if (!title) {
    btn.innerHTML = '⚠️ Preencha o título';
    setTimeout(() => resetJiraBtn(btn), 2500);
    return;
  }

  const description = [
    `*Ambiente:* ${env}`,
    `*URL:* ${url}`,
    `*Severidade:* ${severity}`,
    ...(loadedZephyrKey ? [`*TC Zephyr:* ${loadedZephyrKey}`] : []),
    '',
    '*Passos para reproduzir:*',
    steps || '_Não informado_',
    '',
    '*Comportamento observado:*',
    actual || '_Não informado_',
    '',
    '*Comportamento esperado:*',
    expected || '_Não informado_',
    '',
    '_Reportado pela Bia_',
  ].join('\n');

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="border-top-color:#fff;width:11px;height:11px"></span> Criando...`;

  const result = await sendMsg('createJiraIssue', {
    summary:     title,
    description,
    priority:    severity,
    labels:      ['qa-auto'],
    screenshot:  bugScreenshot || null,
  });

  if (result?.error) {
    btn.innerHTML = `⚠️ Erro`;
    btn.title = result.error;
    btn.disabled = false;
    setTimeout(() => resetJiraBtn(btn), 4000);
    return;
  }

  btn.innerHTML = `✓ ${result.key}`;
  btn.style.background = '#16a34a';
  btn.style.cursor = 'default';

  const footer = document.querySelector('.modal-footer');
  document.querySelector('.jira-issue-link')?.remove();
  const link = document.createElement('a');
  link.className = 'jira-issue-link';
  link.href = result.url;
  link.target = '_blank';
  link.textContent = `↗ Abrir ${result.key} no Jira`;
  footer.insertBefore(link, footer.firstChild);
}

function resetJiraBtn(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.title = '';
  btn.style.background = '';
  btn.style.cursor = '';
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.96 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zm-4.6 4.6c0 2.4 1.96 4.34 4.35 4.35h1.78v1.71c0 2.4 1.96 4.35 4.35 4.35V7.44a.84.84 0 0 0-.84-.84H6.93zm-4.6 4.6c0 2.4 1.97 4.34 4.35 4.34h1.78v1.71c0 2.39 1.96 4.34 4.35 4.34v-9.55a.84.84 0 0 0-.84-.84H2.33z"/></svg> Criar no Jira`;
}

function downloadBugReport() {
  const title = $('bugTitle').value.trim() || 'bug-report';
  const slug  = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const base  = `bug-${slug}-${Date.now()}`;
  const md    = buildBugMarkdown(base);

  downloadBlob(new Blob([md], { type: 'text/markdown' }), `${base}.md`);
  if (bugScreenshot) saveDownload(bugScreenshot, `${base}.jpg`);
}

function copyBugReport() {
  const md  = buildBugMarkdown(undefined);
  const btn = $('bugCopyBtn');
  navigator.clipboard.writeText(md).then(() => {
    btn.textContent = '✓ Copiado!';
    setTimeout(() => {
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar`;
    }, 2000);
  });
}

function setupListeners() {
  settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  chatSendBtn.addEventListener('click', sendChatMessage);
  chatStopBtn.addEventListener('click', stopChat);
  chatNewBtn.addEventListener('click', resetChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  chatInput.addEventListener('input', autoGrowChatInput);
  chatConfirmApprove.addEventListener('click', () => answerChatConfirmation(true));
  chatConfirmDeny.addEventListener('click', () => answerChatConfirmation(false));
  chatHistoryBtn.addEventListener('click', openChatHistory);
  accessBtn.addEventListener('click', toggleAccessibilityMode);
  chatMicBtn.addEventListener('click', () => (micListening ? stopMicListening() : startMicListening()));
  closeChatHistory.addEventListener('click', () => chatHistoryOverlay.classList.add('hidden'));
  chatHistoryOverlay.addEventListener('click', (e) => {
    if (e.target === chatHistoryOverlay) chatHistoryOverlay.classList.add('hidden');
  });

  testInput.addEventListener('input', () => {
    runBtn.disabled = testInput.value.trim() === '';
  });
  testInput.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!agentRunning && testInput.value.trim()) executeTest();
    }
  });

  runBtn.addEventListener('click', () => {
    if (!agentRunning) executeTest();
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopAgent' });
    userStopped = true;
    confirmBar.classList.add('hidden');
    pendingConfirmId = null;

    updateRunningStatus('Parando a execução...');
    addLiveStep('🛑 Parada solicitada — encerrando o passo atual...');
    clearTimeout(stopFallbackTimer);
    const waitForStop = () => {
      if (!userStopped) return;
      chrome.storage.session.get(['runState', 'runHeartbeat'], ({ runState, runHeartbeat }) => {
        if (!userStopped) return;
        const lastBeat = Math.max(runState?.updatedAt || 0, runHeartbeat?.updatedAt || 0);
        const stillAlive = runState?.status === 'running' && Date.now() - lastBeat < 30_000;
        if (stillAlive) {
          stopFallbackTimer = setTimeout(waitForStop, 5_000);
          return;
        }
        userStopped = false;
        agentRunning = false;
        chrome.storage.session.set({ runState: { status: 'idle' } });
        setRunState('idle');
      });
    };
    stopFallbackTimer = setTimeout(waitForStop, 10_000);
  });

  confirmApproveBtn.addEventListener('click', () => answerConfirmation(true));
  confirmDenyBtn.addEventListener('click', () => answerConfirmation(false));

  inspectToggleBtn.addEventListener('click', toggleInspect);
  copySelectorBtn.addEventListener('click', copyInspectedSelector);
  contextRefreshBtn.addEventListener('click', refreshPageContext);

  resultNewBtn.addEventListener('click', () => {
    testInput.value = '';
    loadedZephyrKey = null;
    loadedTestId = null;
    clearVideoResult();
    visualDiffArea.classList.add('hidden');
    runBtn.disabled = true;
    resultAIDetails.classList.add('hidden');
    chrome.storage.session.set({ runState: { status: 'idle' } });
    setRunState('idle');
  });
  resultSaveBtn.addEventListener('click', saveCurrentTest);
  resultBugBtn.addEventListener('click', openBugReportFromResult);
  resultJiraBtn.addEventListener('click', openBugReportFromResult);

  copyAIBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const text = lastResult?.reply || resultAIText.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const prev = copyAIBtn.innerHTML;
      copyAIBtn.textContent = '✓';
      copyAIBtn.style.cssText = 'color:#16a34a;border-color:#16a34a;background:#f0fdf4';
      setTimeout(() => { copyAIBtn.innerHTML = prev; copyAIBtn.style.cssText = ''; }, 2000);
    });
  });

  librarySearch.addEventListener('input', () => renderLibrary(librarySearch.value));

  debugRunBtn.addEventListener('click', runDebug);

  envSelect.addEventListener('change', () => {
    activeEnvName = envSelect.value;
    chrome.storage.local.set({ activeEnvironment: activeEnvName });
  });

  recordBtn.addEventListener('click', startRecordingUI);
  recordStopBtn.addEventListener('click', stopRecordingUI);

  batchStopBtn.addEventListener('click', () => {
    userStopped = true;
    chrome.runtime.sendMessage({ action: 'stopAgent' });
    batchStatusText.textContent = 'Parando o lote — encerrando o teste atual...';
    addBatchProgressLine('🛑 Parada solicitada — o teste em execução será concluído/interrompido');
  });
  batchNewBtn.addEventListener('click', () => setRunState('idle'));
  batchPdfBtn.addEventListener('click', exportBatchPdf);
  batchJsonBtn.addEventListener('click', exportBatchJson);
  resultPdfBtn.addEventListener('click', exportResultPdf);
  zephyrPushBtn.addEventListener('click', pushResultToZephyr);
  $('zephyrAutoPushCheck')?.addEventListener('change', (e) => {
    chrome.storage.local.set({ zephyrAutoPush: e.target.checked });
  });
  videoDownloadBtn.addEventListener('click', downloadVideoFile);

  suggestBtn.addEventListener('click', suggestTestsUI);
  libraryRunSelectedBtn.addEventListener('click', () => {
    chrome.storage.local.get(['savedTests'], (r) => {
      const tests = (r.savedTests || []).filter((t) => selectedTests.has(t.id));
      if (tests.length) runTestsBatch(tests);
    });
  });

  closeBugModal.addEventListener('click', () => bugReportOverlay.classList.add('hidden'));
  bugReportOverlay.addEventListener('click', e => { if (e.target === bugReportOverlay) bugReportOverlay.classList.add('hidden'); });
  $('bugDownloadBtn').addEventListener('click', downloadBugReport);
  $('bugCopyBtn').addEventListener('click', copyBugReport);
  $('bugJiraBtn').addEventListener('click', createBugOnJira);
}

function initTabGrouping() {
  let attempts = 0;
  function tryGroup() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.find(t => !isRestrictedUrl(t.url));
      if (!tab) { if (++attempts < 8) setTimeout(tryGroup, 400); return; }
      chrome.runtime.sendMessage({ action: 'groupCurrentTab', tabId: tab.id }, (res) => {
        if (chrome.runtime.lastError || (res?.error && !res.error.includes('restrita'))) {
          if (++attempts < 8) setTimeout(tryGroup, 400);
        }
      });
    });
  }
  setTimeout(tryGroup, 300);
}

function sendMsg(action, params = {}, timeoutMs = 150_000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    chrome.runtime.sendMessage({ action, ...params }, r => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) resolve(null);
      else resolve(r);
    });
  });
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SENSITIVE_KEY = /token|auth|jwt|bearer|session|api[_-]?key|secret|password|senha|credential|access|refresh/i;
function maskSecret(s) {
  const str = String(s ?? '');
  if (!str) return str;
  if (str.length <= 10) return '••••••';
  return `${str.slice(0, 4)}…${str.slice(-4)} (${str.length} chars — ocultado)`;
}
function redactKV(key, value) {
  return SENSITIVE_KEY.test(String(key)) ? maskSecret(value) : String(value ?? '').substring(0, 100);
}

function renderMarkdown(text) {
  text = String(text || '').replace(/@@FLOWQA(TABLE|CODE)\d+@@/g, '');
  const tables = [];
  const tableRegex = /^(\|.+\|\r?\n)((?:\|[-: ]+\|[-| :\r\n]*\r?\n))((?:\|.+\|\r?\n?)*)/gm;
  text = text.replace(tableRegex, (match, header, separator, body) => {
    const parseRow = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parseRow(header);
    const rows = body.trim().split('\n').filter(r => r.trim());
    const ths = headers.map(h => `<th>${esc(h)}</th>`).join('');
    const trs = rows.map(r => `<tr>${parseRow(r).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    tables.push(`<table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`);
    return `@@FLOWQATABLE${tables.length - 1}@@`;
  });

  const codes = [];
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/```[\s\S]*?```/g, m => {
      codes.push(`<pre><code>${m.slice(3, -3).trim()}</code></pre>`);
      return `@@FLOWQACODE${codes.length - 1}@@`;
    })
    .replace(/`([^`\n]+)`/g, (m, c) => {
      codes.push(`<code>${c}</code>`);
      return `@@FLOWQACODE${codes.length - 1}@@`;
    })
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm,  '<strong>$1</strong>')
    .replace(/^# (.+)$/gm,   '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/_(.+?)_/g,       '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s])((https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/^---+$/gm, '<hr>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n/g, '<br>')
    .replace(/@@FLOWQACODE(\d+)@@/g, (_, i) => codes[Number(i)] || '')
    .replace(/@@FLOWQATABLE(\d+)@@/g, (_, i) => tables[Number(i)] || '');
}

function stepTargetText(a) {
  if (typeof a.result === 'string') {
    const m = a.result.match(/em <\w+> "([^"]+)"/);
    if (m) return `"${m[1]}"`;
  }
  if (a.target?.text)              return `"${a.target.text}"`;
  if (a.selector)                  return `"${a.selector}"`;
  if (a.target?.index !== undefined) return `o elemento [${a.target.index}]`;
  return 'o elemento';
}

function buildStepsFromActions(actions) {
  if (!actions?.length) return '';
  const lines = []; let step = 1;
  actions.forEach(a => {
    if (['wait', 'screenshot', 'get_errors', 'get_links', 'find'].includes(a.type)) return;
    let desc = '';
    if (a.type === 'navigate')        desc = `Navegue para ${a.url || ''}`;
    else if (a.type === 'go_back')    desc = `Volte para a página anterior`;
    else if (a.type === 'click')      desc = `Clique em ${stepTargetText(a)}`;
    else if (a.type === 'fill' || a.type === 'type') desc = `Digite "${a.text || a.value || ''}" no campo ${stepTargetText(a)}`;
    else if (a.type === 'clear')      desc = `Limpe o campo ${stepTargetText(a)}`;
    else if (a.type === 'press_enter') desc = `Pressione Enter em ${stepTargetText(a)}`;
    else if (a.type === 'check_checkbox') desc = `${a.checked === false ? 'Desmarque' : 'Marque'} ${stepTargetText(a)}`;
    else if (a.type === 'search')     desc = `Busque por "${a.text}"`;
    else if (a.type === 'scroll')     desc = `Role a página para ${a.direction === 'up' ? 'cima' : 'baixo'}`;
    else if (a.type === 'scroll_to')  desc = `Role até ${stepTargetText(a)}`;
    else if (a.type === 'scroll_to_text') desc = `Role até o texto "${a.text}"`;
    else if (a.type === 'hover')      desc = `Passe o mouse sobre ${stepTargetText(a)}`;
    else if (a.type === 'key')        desc = `Pressione a tecla ${a.key}`;
    else if (a.type === 'send_keys')  desc = `Pressione ${a.keys || a.key}`;
    else if (a.type === 'select' || a.type === 'select_dropdown_option') desc = `Selecione "${a.optionText || a.value}" em ${stepTargetText(a)}`;
    else if (a.type === 'assert_url_includes') desc = `Verifique que a URL contém "${a.part}"`;
    else if (a.type === 'assert_text') desc = `Verifique que ${a.selector ? `"${a.selector}"` : 'a página'} contém "${a.text}"`;
    else return;
    if (a.error) desc += ` → ❌ Erro: ${a.error}`;
    lines.push(`${step++}. ${desc}`);
  });
  return lines.join('\n');
}

function buildBugMarkdown(base) {
  const title    = $('bugTitle').value.trim()    || 'Bug sem título';
  const url      = $('bugUrl').value.trim();
  const env      = $('bugEnv').value;
  const steps    = $('bugSteps').value.trim();
  const actual   = $('bugActual').value.trim();
  const expected = $('bugExpected').value.trim();
  const severity = $('bugSeverity').value;
  const now      = new Date().toLocaleString('pt-BR');
  const imgRef   = base && bugScreenshot ? `\n## 📸 Screenshot\n\n![Screenshot](./${base}.jpg)\n` : '';

  return `# Bug Report — ${title}

**Severidade:** ${severity}
**Ambiente:** ${env}
**URL:** ${url}
**Reportado em:** ${now}

---

## Passos para Reproduzir

${steps || '_Não informado_'}

---

## Comportamento Observado

${actual || '_Não informado_'}

---

## Comportamento Esperado

${expected || '_Não informado_'}

---
${imgRef}
_Relatório gerado pelo **Flow**_
`;
}

function buildQAReportHTML(d, container, md) {
  const scoreIssues = [];
  if (!d.security.https)                     scoreIssues.push({ sev: 'critical', msg: 'Página sem HTTPS' });
  if (d.security.mixedContent.length > 0)    scoreIssues.push({ sev: 'warning',  msg: `${d.security.mixedContent.length} recurso(s) em HTTP (mixed content)` });
  if (d.accessibility.imgsWithoutAlt > 0)    scoreIssues.push({ sev: 'warning',  msg: `${d.accessibility.imgsWithoutAlt} img sem atributo alt` });
  if (d.accessibility.h1Count !== 1)          scoreIssues.push({ sev: 'warning',  msg: `H1 count = ${d.accessibility.h1Count} (esperado: 1)` });
  if (d.accessibility.btnsWithoutLabel > 0)   scoreIssues.push({ sev: 'warning',  msg: `${d.accessibility.btnsWithoutLabel} botão(ões) sem rótulo acessível` });
  if (d.accessibility.linksWithoutText > 0)   scoreIssues.push({ sev: 'warning',  msg: `${d.accessibility.linksWithoutText} link(s) sem texto` });
  if (d.errors.length > 0)                    scoreIssues.push({ sev: 'critical', msg: `${d.errors.length} erro(s) JavaScript detectado(s)` });
  if (d.network.interceptedErrors?.length > 0) scoreIssues.push({ sev: 'critical', msg: `${d.network.interceptedErrors.length} requisição(ões) com erro de rede` });
  if (d.tokens.filter(t => t.decoded?.expired).length > 0) scoreIssues.push({ sev: 'critical', msg: 'JWT(s) expirado(s) detectado(s)' });
  if (d.security.externalScripts?.length > 3)  scoreIssues.push({ sev: 'info',    msg: `${d.security.externalScripts.length} scripts externos carregados` });
  if (d.tokens.length > 0)                    scoreIssues.push({ sev: 'info',    msg: `${d.tokens.length} token(s) detectado(s) no storage` });

  const criticalCount = scoreIssues.filter(i => i.sev === 'critical').length;
  const warningCount  = scoreIssues.filter(i => i.sev === 'warning').length;

  const apiTable = d.network.apiCalls.length > 0
    ? `<table class="qa-api-table">
        <tr><th>Tipo</th><th>URL</th><th>Duração</th><th>Tamanho</th></tr>
        ${d.network.apiCalls.slice(0, 15).map(c => `
          <tr><td>${esc(c.type)}</td><td>${esc(c.url.substring(0,60))}${c.url.length>60?'…':''}</td><td>${esc(c.duration)}</td><td>${esc(c.size)}</td></tr>
        `).join('')}</table>`
    : '<span style="color:var(--text-muted);font-size:11px">Nenhuma requisição XHR/Fetch registrada (recarregue a página com o debug ativo para capturar em tempo real)</span>';

  const tokenCards = d.tokens.length > 0
    ? d.tokens.map(t => `
        <div class="qa-token-card">
          <div class="qa-token-name">${esc(t.key)} <span style="font-size:9px;font-weight:400;color:var(--text-muted)">[${esc(t.source)}${t.isJWT ? ' · JWT' : ''}]</span></div>
          <div class="qa-token-val">${esc(maskSecret(t.preview))}</div>
          ${t.decoded ? `<div style="margin-top:4px;font-size:10.5px;color:var(--text-muted)">
            ${t.decoded.sub   ? `sub: <b>${esc(t.decoded.sub)}</b> ` : ''}
            ${t.decoded.email ? `· email: <b>${esc(maskSecret(t.decoded.email))}</b> ` : ''}
            ${t.decoded.exp   ? `· exp: <b>${esc(t.decoded.exp)}</b>` : ''}
            ${t.decoded.expired === true ? '<span style="color:#dc2626;font-weight:700"> ⚠️ EXPIRADO</span>' : ''}
          </div>` : ''}
        </div>`).join('')
    : '<span style="color:var(--text-muted);font-size:11px">Nenhum token detectado</span>';

  const issuesList = scoreIssues.length > 0
    ? `<ul class="qa-issues-list">${scoreIssues.map(i =>
        `<li><span class="qa-issue-dot ${i.sev}"></span><span>${esc(i.msg)}</span></li>`
      ).join('')}</ul>`
    : '<span style="color:#16a34a;font-size:11px;font-weight:600">✓ Nenhum problema detectado</span>';

  const sv = (val, ok, warn) => {
    if (val === ok)   return `<span class="qa-value ok">${esc(val)}</span>`;
    if (val === warn) return `<span class="qa-value warn">${esc(val)}</span>`;
    return `<span class="qa-value error">${esc(val)}</span>`;
  };

  container.innerHTML = `
    <div class="qa-report-header">
      <div class="qa-report-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h8M8 6a4 4 0 0 0-4 4v1h16v-1a4 4 0 0 0-4-4M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M4 11v2a8 8 0 0 0 16 0v-2"/></svg>
        QA Debug Report
        ${criticalCount > 0 ? `<span style="background:#dc2626;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:800">${criticalCount} crítico${criticalCount>1?'s':''}</span>` : ''}
        ${warningCount  > 0 ? `<span style="background:#d97706;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:800">${warningCount} aviso${warningCount>1?'s':''}</span>` : ''}
      </div>
      <div class="qa-download-row">
        <button class="qa-download-btn" id="qaDownloadMd">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-16 9v2h18v-2H3z"/></svg>
          .md
        </button>
        <button class="qa-download-btn" id="qaDownloadPdf">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          PDF
        </button>
      </div>
    </div>

    <div class="qa-section">
      <div class="qa-section-title">🌐 Página</div>
      <div class="qa-kv-grid">
        <span class="qa-key">URL</span><span class="qa-value">${esc(d.page.url)}</span>
        <span class="qa-key">Título</span><span class="qa-value">${esc(d.page.title)}</span>
        <span class="qa-key">Idioma</span><span class="qa-value">${esc(d.page.lang)}</span>
        <span class="qa-key">Charset</span><span class="qa-value">${esc(d.page.charset)}</span>
        <span class="qa-key">Canonical</span><span class="qa-value">${esc(d.page.canonical)}</span>
        <span class="qa-key">Meta desc.</span><span class="qa-value">${esc(d.page.metaDesc)}</span>
        <span class="qa-key">Viewport</span><span class="qa-value">${esc(d.page.viewport)}</span>
      </div>
    </div>

    <div class="qa-section">
      <div class="qa-section-title">🔒 Segurança</div>
      <div class="qa-kv-grid">
        <span class="qa-key">HTTPS</span>${sv(d.security.https ? 'Sim ✓' : 'Não ✗', 'Sim ✓', 'Não ✗')}
        <span class="qa-key">Mixed Content</span>${d.security.mixedContent.length === 0 ? '<span class="qa-value ok">Nenhum ✓</span>' : `<span class="qa-value warn">${d.security.mixedContent.length} recurso(s) HTTP</span>`}
        <span class="qa-key">Scripts ext.</span><span class="qa-value">${d.security.externalScripts?.length || 0}</span>
        <span class="qa-key">Formulários</span><span class="qa-value">${d.security.forms?.length || 0} (${d.security.forms?.filter(f=>f.hasCSRF).length || 0} com CSRF)</span>
        <span class="qa-key">iFrames</span><span class="qa-value">${d.security.iframes?.length || 0}</span>
      </div>
    </div>

    <div class="qa-section">
      <div class="qa-section-title">🔑 Tokens &amp; Storage</div>
      ${tokenCards}
      <div style="margin-top:8px"><div class="qa-kv-grid">
        <span class="qa-key">localStorage</span><span class="qa-value">${Object.keys(d.localStorage).filter(k=>k!=='_error').length} chave(s)</span>
        <span class="qa-key">sessionStorage</span><span class="qa-value">${Object.keys(d.sessionStorage).filter(k=>k!=='_error').length} chave(s)</span>
        <span class="qa-key">Cookies</span><span class="qa-value">${d.cookies.length} cookie(s)</span>
      </div></div>
    </div>

    <div class="qa-section">
      <div class="qa-section-title">⚡ Performance</div>
      <div class="qa-kv-grid">
        <span class="qa-key">Load Time</span><span class="qa-value">${esc(d.performance.loadTime)}</span>
        <span class="qa-key">DOMContentLoaded</span><span class="qa-value">${esc(d.performance.domContentLoaded)}</span>
        <span class="qa-key">TTFB</span><span class="qa-value">${esc(d.performance.ttfb)}</span>
        <span class="qa-key">Transfer Size</span><span class="qa-value">${esc(d.performance.transferSize)}</span>
        <span class="qa-key">Total recursos</span><span class="qa-value">${d.network.totalResources} (${esc(d.network.totalSize)})</span>
      </div>
    </div>

    <div class="qa-section">
      <div class="qa-section-title">🌐 Network / APIs (${d.network.apiCalls.length})</div>
      ${apiTable}
      ${d.network.interceptedErrors?.length > 0 ? `
        <div style="margin-top:6px;color:#dc2626;font-size:11px;font-weight:600">⚠️ ${d.network.interceptedErrors.length} erro(s) de rede interceptado(s):</div>
        <ul style="margin:4px 0 0 12px;font-size:10.5px;color:var(--text-muted)">
          ${d.network.interceptedErrors.slice(0,5).map(e=>`<li>${esc(e.method)} ${esc(e.url?.substring(0,60))} → ${esc(e.status||'FAILED')}</li>`).join('')}
        </ul>` : ''}
    </div>

    <div class="qa-section">
      <div class="qa-section-title">🏗️ DOM</div>
      <div class="qa-kv-grid">
        <span class="qa-key">Formulários</span><span class="qa-value">${d.dom.forms}</span>
        <span class="qa-key">Inputs</span><span class="qa-value">${d.dom.inputs}</span>
        <span class="qa-key">Botões</span><span class="qa-value">${d.dom.buttons}</span>
        <span class="qa-key">Links</span><span class="qa-value">${d.dom.links}</span>
        <span class="qa-key">Imagens</span><span class="qa-value">${d.dom.images}</span>
        <span class="qa-key">H1</span>${d.dom.h1Count===1?'<span class="qa-value ok">1 ✓</span>':`<span class="qa-value warn">${d.dom.h1Count}</span>`}
        <span class="qa-key">Total nós</span><span class="qa-value">${d.dom.totalNodes}</span>
      </div>
    </div>

    <div class="qa-section">
      <div class="qa-section-title">♿ Acessibilidade</div>
      <div class="qa-kv-grid">
        <span class="qa-key">lang html</span>${d.accessibility.htmlLang.includes('⚠️')?`<span class="qa-value error">${esc(d.accessibility.htmlLang)}</span>`:`<span class="qa-value ok">${esc(d.accessibility.htmlLang)}</span>`}
        <span class="qa-key">Img sem alt</span>${d.accessibility.imgsWithoutAlt>0?`<span class="qa-value warn">${d.accessibility.imgsWithoutAlt}</span>`:'<span class="qa-value ok">0 ✓</span>'}
        <span class="qa-key">Botões sem label</span>${d.accessibility.btnsWithoutLabel>0?`<span class="qa-value warn">${d.accessibility.btnsWithoutLabel}</span>`:'<span class="qa-value ok">0 ✓</span>'}
        <span class="qa-key">Inputs sem label</span>${d.accessibility.inputsWithoutLabel>0?`<span class="qa-value warn">${d.accessibility.inputsWithoutLabel}</span>`:'<span class="qa-value ok">0 ✓</span>'}
        <span class="qa-key">Links sem texto</span>${d.accessibility.linksWithoutText>0?`<span class="qa-value warn">${d.accessibility.linksWithoutText}</span>`:'<span class="qa-value ok">0 ✓</span>'}
        <span class="qa-key">Skip link</span>${d.accessibility.hasSkipLink?'<span class="qa-value ok">Sim ✓</span>':'<span class="qa-value warn">Não</span>'}
        <span class="qa-key">Main landmark</span>${d.accessibility.hasMainLandmark?'<span class="qa-value ok">Sim ✓</span>':'<span class="qa-value warn">Não</span>'}
      </div>
    </div>

    <div class="qa-section">
      <div class="qa-section-title">⚠️ Erros JavaScript (${d.errors.length})</div>
      ${d.errors.length === 0
        ? '<span style="color:#16a34a;font-size:11px;font-weight:600">✓ Nenhum erro detectado</span>'
        : `<ul style="margin:0 0 0 12px;font-size:10.5px;color:var(--text-muted)">
            ${d.errors.slice(0,8).map(e=>`<li style="margin:2px 0"><span style="color:#dc2626;font-weight:600">[${esc(e.type)}]</span> ${esc(e.message?.substring(0,100))}${e.source?` <span style="color:var(--text-muted)">@ ${esc(e.source.split('/').pop())}</span>`:''}</li>`).join('')}
            ${d.errors.length>8?`<li style="color:var(--text-muted)">...e mais ${d.errors.length-8}</li>`:''}
          </ul>`}
    </div>

    <div class="qa-section">
      <div class="qa-section-title">📋 Resumo de Issues</div>
      ${issuesList}
    </div>`;

  container.querySelector('#qaDownloadMd')?.addEventListener('click', () => {
    downloadBlob(new Blob([md], { type: 'text/markdown' }),
      `qa-report-${d.page.domain || 'page'}-${new Date().toISOString().slice(0,10)}.md`);
  });

  container.querySelector('#qaDownloadPdf')?.addEventListener('click', () => {
    openPrintable(`Bia — QA Debug Report — ${d.page.domain || d.page.url}`, `
      <h1>QA Debug Report — Bia</h1>
      <p><b>URL:</b> ${esc(d.page.url)}<br><b>Página:</b> ${esc(d.page.title)}</p>
      ${renderMarkdown(md)}`);
  });
}

function buildQAMarkdown(d) {
  const now = new Date().toISOString();

  const tokensMd = d.tokens.length > 0
    ? d.tokens.map(t => {
        let s = `**${t.key}** \`[${t.source}${t.isJWT ? ' · JWT' : ''}]\`\n\`${maskSecret(t.preview)}\``;
        if (t.decoded) {
          s += '\n\n| Campo | Valor |\n|---|---|\n';
          if (t.decoded.sub)   s += `| sub   | \`${t.decoded.sub}\` |\n`;
          if (t.decoded.email) s += `| email | \`${maskSecret(t.decoded.email)}\` |\n`;
          if (t.decoded.exp)   s += `| exp   | \`${t.decoded.exp}\`${t.decoded.expired ? ' ⚠️ **EXPIRADO**' : ''} |\n`;
        }
        return s;
      }).join('\n\n')
    : '_Nenhum token detectado_';

  const apiCallsMd = d.network.apiCalls.length > 0
    ? '| Tipo | URL | Duração | Tamanho |\n|---|---|---|---|\n' +
      d.network.apiCalls.slice(0,30).map(c => `| ${c.type} | \`${c.url.substring(0,80)}\` | ${c.duration} | ${c.size} |`).join('\n')
    : '_Nenhuma chamada XHR/Fetch registrada_';

  const errorsMd = d.errors.length > 0
    ? d.errors.slice(0,20).map(e => `- **[${e.type}]** ${e.message}${e.source ? ` _(${e.source.split('/').pop()}:${e.line})_` : ''}`).join('\n')
    : '_Nenhum erro detectado_ ✓';

  const issuesMd = [];
  if (!d.security.https)                     issuesMd.push('- 🔴 **CRITICAL** Página sem HTTPS');
  if (d.security.mixedContent.length > 0)    issuesMd.push(`- 🟡 **WARNING** ${d.security.mixedContent.length} recurso(s) em HTTP`);
  if (d.accessibility.imgsWithoutAlt > 0)    issuesMd.push(`- 🟡 **WARNING** ${d.accessibility.imgsWithoutAlt} img sem atributo alt`);
  if (d.accessibility.h1Count !== 1)          issuesMd.push(`- 🟡 **WARNING** H1 count = ${d.accessibility.h1Count}`);
  if (d.accessibility.btnsWithoutLabel > 0)   issuesMd.push(`- 🟡 **WARNING** ${d.accessibility.btnsWithoutLabel} botão(ões) sem label`);
  if (d.errors.length > 0)                    issuesMd.push(`- 🔴 **CRITICAL** ${d.errors.length} erro(s) JavaScript`);
  if (d.network.interceptedErrors?.length > 0) issuesMd.push(`- 🔴 **CRITICAL** ${d.network.interceptedErrors.length} erro(s) de rede`);
  if (d.tokens.filter(t=>t.decoded?.expired).length > 0) issuesMd.push('- 🔴 **CRITICAL** JWT(s) expirado(s)');

  const lsKeys = Object.keys(d.localStorage).filter(k => k !== '_error');
  const ssKeys = Object.keys(d.sessionStorage).filter(k => k !== '_error');

  return `# QA Debug Report — Bia

**URL:** ${d.page.url}
**Página:** ${d.page.title}
**Gerado em:** ${now}

---

## 📋 Resumo de Issues

${issuesMd.length > 0 ? issuesMd.join('\n') : '✅ Nenhum problema detectado'}

---

## 🌐 Página

| Campo | Valor |
|---|---|
| URL | \`${d.page.url}\` |
| Título | ${d.page.title} |
| Idioma | ${d.page.lang} |
| Canonical | ${d.page.canonical} |
| Meta Description | ${d.page.metaDesc} |
| Viewport | ${d.page.viewport} |

---

## 🔒 Segurança

| Verificação | Status |
|---|---|
| HTTPS | ${d.security.https ? '✅ Sim' : '❌ Não'} |
| Mixed Content | ${d.security.mixedContent.length === 0 ? '✅ Nenhum' : `⚠️ ${d.security.mixedContent.length} recurso(s)`} |
| Scripts externos | ${d.security.externalScripts?.length || 0} |

---

## 🔑 Tokens & Storage

> ⚠️ _Valores sensíveis (tokens, credenciais, sessão) foram mascarados nesta exportação._

${tokensMd}

### localStorage (${lsKeys.length} chaves)

${lsKeys.length > 0 ? lsKeys.map(k => `- **\`${k}\`**: \`${redactKV(k, d.localStorage[k])}\``).join('\n') : '_Vazio_'}

### sessionStorage (${ssKeys.length} chaves)

${ssKeys.length > 0 ? ssKeys.map(k => `- **\`${k}\`**: \`${redactKV(k, d.sessionStorage[k])}\``).join('\n') : '_Vazio_'}

### Cookies (${d.cookies.length})

${d.cookies.length > 0 ? d.cookies.map(c => `- **\`${c.name}\`**: \`${redactKV(c.name, c.value)}\``).join('\n') : '_Nenhum_'}

---

## ⚡ Performance

| Métrica | Valor |
|---|---|
| Load Time | ${d.performance.loadTime} |
| DOMContentLoaded | ${d.performance.domContentLoaded} |
| TTFB | ${d.performance.ttfb} |
| Transfer Size | ${d.performance.transferSize} |
| Total recursos | ${d.network.totalResources} (${d.network.totalSize}) |

---

## 🌐 Network / APIs

${apiCallsMd}

---

## 🏗️ DOM

| Elemento | Qtd |
|---|---|
| Formulários | ${d.dom.forms} |
| Inputs | ${d.dom.inputs} |
| Botões | ${d.dom.buttons} |
| Links | ${d.dom.links} |
| Imagens | ${d.dom.images} |
| H1 | ${d.dom.h1Count} ${d.dom.h1Count===1?'✅':'⚠️'} |
| Total nós | ${d.dom.totalNodes} |

---

## ♿ Acessibilidade

| Verificação | Resultado |
|---|---|
| lang no \`<html>\` | ${d.accessibility.htmlLang} |
| Imagens sem alt | ${d.accessibility.imgsWithoutAlt} ${d.accessibility.imgsWithoutAlt>0?'⚠️':'✅'} |
| Botões sem label | ${d.accessibility.btnsWithoutLabel} ${d.accessibility.btnsWithoutLabel>0?'⚠️':'✅'} |
| Inputs sem label | ${d.accessibility.inputsWithoutLabel} ${d.accessibility.inputsWithoutLabel>0?'⚠️':'✅'} |
| Links sem texto | ${d.accessibility.linksWithoutText} ${d.accessibility.linksWithoutText>0?'⚠️':'✅'} |
| Skip link | ${d.accessibility.hasSkipLink?'✅':'❌'} |
| Landmark \`<main>\` | ${d.accessibility.hasMainLandmark?'✅':'⚠️'} |

---

## ⚠️ Erros JavaScript (${d.errors.length})

${errorsMd}

---

_Relatório gerado pelo **Flow** — ${now}_
`;
}
