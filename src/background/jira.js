function basicAuth(email, token) {
  if (!email) return `Bearer ${token}`;
  return `Basic ${btoa(`${email}:${token}`)}`;
}

function priorityName(severity) {
  const map = {
    'Crítica': 'Highest',
    'Alta':    'High',
    'Média':   'Medium',
    'Baixa':   'Low',
  };
  return map[severity] || severity || 'Medium';
}

async function jiraFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (e) {
    throw new Error(`Falha de rede ao chamar o Jira: ${e.message}`);
  }
}

export async function createJiraIssue({ jiraUrl, email, token, projectKey, summary, description, priority, labels }) {
  const base = jiraUrl.replace(/\/$/, '');
  const res = await jiraFetch(`${base}/rest/api/2/issue`, {
    method: 'POST',
    headers: {
      'Authorization':  basicAuth(email, token),
      'Content-Type':   'application/json',
      'Accept':         'application/json',
    },
    body: JSON.stringify({
      fields: {
        project:     { key: projectKey },
        summary,
        description: description || '',
        issuetype:   { name: 'Bug' },
        priority:    { name: priorityName(priority) },
        labels:      labels || ['qa-auto'],
      }
    })
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msgs = body.errorMessages || [];
    const errs = body.errors ? Object.values(body.errors) : [];
    const detail = [...msgs, ...errs].join('; ') || `HTTP ${res.status}`;
    throw new Error(`Jira: ${detail}`);
  }

  return body;
}

export async function getJiraIssue({ jiraUrl, email, token, key }) {
  const base = jiraUrl.replace(/\/$/, '');
  const fields = 'summary,description,status,priority,labels,issuetype,assignee,comment';
  const res = await jiraFetch(`${base}/rest/api/2/issue/${encodeURIComponent(key)}?fields=${fields}`, {
    headers: {
      'Authorization': basicAuth(email, token),
      'Accept':        'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body.errorMessages || []).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Jira (${key}): ${detail}`);
  }

  const f = body.fields || {};
  const lines = [
    `🎫 ${body.key} — ${f.summary || '(sem título)'}`,
    `Tipo: ${f.issuetype?.name || '?'} | Status: ${f.status?.name || '?'} | Prioridade: ${f.priority?.name || '?'}`,
  ];
  if (f.assignee?.displayName) lines.push(`Responsável: ${f.assignee.displayName}`);
  if (f.labels?.length) lines.push(`Labels: ${f.labels.join(', ')}`);
  lines.push('', 'Descrição:', String(f.description || '(vazia)').slice(0, 6000));
  const comments = (f.comment?.comments || []).slice(-3)
    .map((c) => `- ${c.author?.displayName || '?'}: ${String(c.body || '').slice(0, 500)}`);
  if (comments.length) lines.push('', 'Últimos comentários:', ...comments);

  return { key: body.key, summary: f.summary || '', text: lines.join('\n').slice(0, 8000) };
}

export async function attachScreenshotToJira({ jiraUrl, email, token, issueKey, screenshotDataUrl }) {
  const base = jiraUrl.replace(/\/$/, '');

  const mimeMatch = screenshotDataUrl.match(/^data:image\/(\w+);base64,/);
  const ext  = mimeMatch ? mimeMatch[1] : 'jpeg';
  const mime = `image/${ext}`;
  const dataStr = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const binary  = atob(dataStr);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  const form = new FormData();
  form.append('file', blob, `evidencia-${issueKey}.${ext === 'jpeg' ? 'jpg' : ext}`);

  const res = await jiraFetch(`${base}/rest/api/2/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: {
      'Authorization':       basicAuth(email, token),
      'X-Atlassian-Token':   'no-check',
    },
    body: form,
  });

  return res.ok;
}
