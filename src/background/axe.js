export async function runAxeAudit(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/vendor/axe.min.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const result = await window.axe.run(document, {
          resultTypes: ['violations'],
          reporter: 'v2',
        });
        return result.violations.map((v) => ({
          id: v.id,
          impact: v.impact || 'minor',
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.length,
          sample: v.nodes.slice(0, 3).map((n) => (n.target || []).join(' ')).filter(Boolean),
        }));
      },
    });
    return results?.[0]?.result || [];
  } catch (e) {
    throw new Error(`Auditoria de acessibilidade falhou: ${e.message}`);
  }
}

const IMPACT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

export function formatAxeViolations(violations) {
  if (!violations || violations.length === 0) {
    return 'Auditoria axe-core (WCAG): nenhuma violação detectada nesta página.';
  }
  const sorted = [...violations].sort((a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9));
  const lines = sorted.slice(0, 15).map((v) =>
    `[${v.impact}] ${v.id}: ${v.help} — ${v.nodes} elemento(s)${v.sample.length ? ` (ex.: ${v.sample.join(' · ')})` : ''}`
  );
  const extra = sorted.length > 15 ? `\n… e mais ${sorted.length - 15} violação(ões).` : '';
  return `Auditoria axe-core (WCAG): ${sorted.length} violação(ões) encontradas:\n${lines.join('\n')}${extra}`;
}
