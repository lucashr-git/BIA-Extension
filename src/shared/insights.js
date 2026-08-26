export const RUN_HISTORY_LIMIT = 500;

export function appendHistory(history, entries) {
  const merged = [...(history || []), ...entries];
  return merged.length > RUN_HISTORY_LIMIT ? merged.slice(-RUN_HISTORY_LIMIT) : merged;
}

export function computeFlakyMap(history) {
  const byTest = new Map();
  for (const run of history || []) {
    if (!run.testId) continue;
    if (!byTest.has(run.testId)) byTest.set(run.testId, []);
    byTest.get(run.testId).push(run);
  }
  const flaky = new Map();
  for (const [testId, runs] of byTest) {
    const recent = runs.slice(-5);
    const passes = recent.filter((r) => r.status === 'passed').length;
    const fails = recent.filter((r) => r.status === 'failed').length;
    if (passes > 0 && fails > 0) {
      flaky.set(testId, { total: recent.length, passes, fails, failRate: fails / recent.length });
    }
  }
  return flaky;
}

export function summarizeMetrics(history, windowDays = 30) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const recent = (history || []).filter((r) => (r.ts || 0) >= cutoff);
  const counts = { passed: 0, failed: 0, inconclusive: 0 };
  let durationSum = 0;
  let durationCount = 0;
  for (const r of recent) {
    if (counts[r.status] !== undefined) counts[r.status]++;
    if (r.durationMs > 0) { durationSum += r.durationMs; durationCount++; }
  }
  const total = recent.length;
  const decided = counts.passed + counts.failed;
  return {
    total,
    ...counts,
    passRate: decided > 0 ? counts.passed / decided : null,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
  };
}

export function buildDailyTrend(history, days = 14) {
  const out = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = startOfToday.getTime() - i * dayMs;
    const dayEnd = dayStart + dayMs;
    const runs = (history || []).filter((r) => r.ts >= dayStart && r.ts < dayEnd);
    out.push({
      day: new Date(dayStart).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      passed: runs.filter((r) => r.status === 'passed').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      other: runs.filter((r) => r.status !== 'passed' && r.status !== 'failed').length,
    });
  }
  return out;
}

export function buildPrioritySuggestions(history, tests, limit = 10) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const flaky = computeFlakyMap(history);
  const lastRunByTest = new Map();
  for (const run of history || []) {
    if (!run.testId) continue;
    const prev = lastRunByTest.get(run.testId);
    if (!prev || run.ts > prev.ts) lastRunByTest.set(run.testId, run);
  }

  const scored = (tests || []).map((t) => {
    const last = lastRunByTest.get(t.id);
    const reasons = [];
    let score = 0;
    if (!last) { score += 3; reasons.push('nunca executado'); }
    else {
      if (last.status === 'failed') { score += 2; reasons.push('última execução falhou'); }
      const daysSince = Math.floor((now - last.ts) / dayMs);
      if (daysSince >= 7) { score += 1; reasons.push(`sem rodar há ${daysSince} dias`); }
    }
    if (flaky.has(t.id)) { score += 2; reasons.push('instável (flaky)'); }
    return { id: t.id, name: t.name, suite: t.suite || '', score, reasons };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function aggregateBy(history, keyOf) {
  const groups = new Map();
  for (const r of history || []) {
    const key = keyOf(r);
    if (key === null || key === undefined || key === '') continue;
    if (!groups.has(key)) {
      groups.set(key, { total: 0, passed: 0, failed: 0, other: 0, durationSum: 0, durationCount: 0 });
    }
    const g = groups.get(key);
    g.total++;
    if (r.status === 'passed') g.passed++;
    else if (r.status === 'failed') g.failed++;
    else g.other++;
    if (r.durationMs > 0) { g.durationSum += r.durationMs; g.durationCount++; }
  }
  const out = [];
  for (const [key, g] of groups) {
    const decided = g.passed + g.failed;
    out.push({
      key,
      total: g.total,
      passed: g.passed,
      failed: g.failed,
      other: g.other,
      passRate: decided > 0 ? g.passed / decided : null,
      avgDurationMs: g.durationCount > 0 ? Math.round(g.durationSum / g.durationCount) : null,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}
