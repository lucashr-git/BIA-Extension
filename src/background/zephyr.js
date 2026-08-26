export const ZEPHYR_DEFAULT_BASE_URL = 'https://api.zephyrscale.smartbear.com/v2';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function zephyrFetch({ baseUrl, token }, path, options = {}) {
  const base = (baseUrl || ZEPHYR_DEFAULT_BASE_URL).replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${base}${path}`, { ...options, headers: headers(token) });
  } catch (e) {
    throw new Error(`Falha de rede ao chamar o Zephyr: ${e.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    let hint = '';
    if ([401, 403].includes(res.status)) hint = ' — verifique o API Token do Zephyr no Dashboard';
    else if (res.status === 404) hint = ' — verifique a chave/projeto informados';
    throw new Error(`Zephyr: ${body.message || `HTTP ${res.status}`}${hint}`);
  }
  return body;
}

export function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildPromptFromZephyr(testCase, steps) {
  const lines = [];
  const objective = stripHtml(testCase.objective || '');
  if (objective) lines.push(objective, '');

  const values = steps?.values || [];
  if (values.length > 0) {
    values.forEach((step, i) => {
      const inline = step.inline || {};
      const desc = stripHtml(inline.description || '');
      const data = stripHtml(inline.testData || '');
      const expected = stripHtml(inline.expectedResult || '');
      if (!desc && !expected) return;
      let line = `${i + 1}. ${desc || 'Execute o passo'}`;
      if (data) line += `\n   Dados: ${data}`;
      if (expected) line += `\n   Verifique: ${expected}`;
      lines.push(line);
    });
  }
  if (lines.length === 0) lines.push(stripHtml(testCase.name || ''));
  return lines.join('\n').trim();
}

export async function zephyrGetTestCase(config, key) {
  const testCase = await zephyrFetch(config, `/testcases/${encodeURIComponent(key)}`);
  const steps = await zephyrFetch(config, `/testcases/${encodeURIComponent(key)}/teststeps?maxResults=100`).catch(() => null);
  return {
    key: testCase.key,
    name: testCase.name || testCase.key,
    prompt: buildPromptFromZephyr(testCase, steps),
  };
}

export async function zephyrListCycles(config, projectKey) {
  const body = await zephyrFetch(config, `/testcycles?projectKey=${encodeURIComponent(projectKey)}&maxResults=50`);
  return (body.values || []).map((c) => ({ key: c.key, name: c.name || c.key }));
}

export async function zephyrCreateExecution(config, { projectKey, testCaseKey, testCycleKey, statusName, comment }) {
  return zephyrFetch(config, '/testexecutions', {
    method: 'POST',
    body: JSON.stringify({
      projectKey,
      testCaseKey,
      ...(testCycleKey ? { testCycleKey } : {}),
      statusName,
      comment: (comment || '').slice(0, 30000),
      actualEndDate: new Date().toISOString(),
    }),
  });
}

export function parsePromptSteps(prompt) {
  const steps = [];
  for (const line of String(prompt || '').split('\n')) {
    const m = line.match(/^\s*\d+[.)]\s*(.+)$/);
    if (m) steps.push({ inline: { description: m[1].trim().slice(0, 2000) } });
  }
  return steps;
}

export async function zephyrExportTestCase(config, { projectKey, name, objective }) {
  const created = await zephyrFetch(config, '/testcases', {
    method: 'POST',
    body: JSON.stringify({
      projectKey,
      name: String(name || 'Teste Bia').slice(0, 255),
      objective: String(objective || '').slice(0, 10000),
    }),
  });
  const steps = parsePromptSteps(objective);
  if (created?.key && steps.length > 0) {
    await zephyrFetch(config, `/testcases/${encodeURIComponent(created.key)}/teststeps`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'OVERWRITE', items: steps }),
    }).catch(() => {});
  }
  return created;
}
