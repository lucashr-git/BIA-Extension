export function substituteVars(text, vars = {}) {
  const missing = new Set();
  const result = String(text || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined && vars[name] !== null) {
      return String(vars[name]);
    }
    missing.add(name);
    return match;
  });
  return { text: result, missing: [...missing] };
}

export function parseDataset(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { rows: [] };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { rows: [], error: `JSON inválido: ${e.message}` };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: 'O dataset deve ser um array JSON: [{"campo": "valor"}, ...]' };
  const rows = parsed.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (rows.length !== parsed.length) return { rows: [], error: 'Cada linha do dataset deve ser um objeto {"campo": "valor"}' };
  return { rows };
}

export function expandBatchItems(items, envVars = {}, datasetRows = []) {
  const expanded = [];
  for (const item of items) {
    if (datasetRows.length > 0) {
      datasetRows.forEach((row, i) => {
        const { text, missing } = substituteVars(item.prompt, { ...envVars, ...row });
        expanded.push({ ...item, name: `${item.name} — linha ${i + 1}`, prompt: text, missing });
      });
    } else {
      const { text, missing } = substituteVars(item.prompt, envVars);
      expanded.push({ ...item, name: item.name, prompt: text, missing });
    }
  }
  return expanded;
}

export function parseEnvironments(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { environments: {} };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { environments: {}, error: `JSON inválido: ${e.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { environments: {}, error: 'Environments deve ser um objeto: {"staging": {"baseUrl": "..."}, ...}' };
  }
  for (const [name, vars] of Object.entries(parsed)) {
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
      return { environments: {}, error: `O ambiente "${name}" deve ser um objeto de variáveis` };
    }
  }
  return { environments: parsed };
}
