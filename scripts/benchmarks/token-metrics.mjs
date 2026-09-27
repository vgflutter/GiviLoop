// Counts emitted by one fresh `codex exec --json` task. Never estimate missing
// usage from text length or add cached/reasoning subsets to their parent totals.
export function tokenMetrics(events) {
  const completions = events.filter(e => e.type === 'turn.completed');
  if (completions.length !== 1 || events.some(e => e.type === 'turn.failed')) throw new Error('Expected one successfully completed Codex turn with usage.');
  const usage = completions[0].usage;
  const integer = (name, optional = false) => {
    const value = usage?.[name];
    if (optional && value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Missing or invalid usage.${name}`);
    return value;
  };
  const input = integer('input_tokens'), cached = integer('cached_input_tokens'), output = integer('output_tokens');
  const reasoning = integer('reasoning_output_tokens', true), cacheWrite = integer('cache_write_input_tokens', true);
  if (cached > input || reasoning !== null && reasoning > output || cacheWrite !== null && cacheWrite > input - cached) throw new Error('Usage subsets exceed their parent counts.');
  return { inputTokens: input, cachedInputTokens: cached, uncachedInputTokens: input - cached,
    cacheWriteInputTokens: cacheWrite, outputTokens: output, reasoningOutputTokens: reasoning,
    observedAgentTokens: input + output, webReviewerTokens: null, totalWorkflowTokens: null,
    billedCost: null, subscriptionQuotaUsed: null };
}

export function hasScopedExport(events, runId) {
  return events.some(event => {
    const call=event.item;
    if(event.type!=='item.completed' || call?.type!=='mcp_tool_call' || call.server!=='giviloop' || call.tool!=='givi_export_report' || call.status!=='completed' || call.error || call.arguments?.runId!==runId || call.result?.isError) return false;
    return call.result?.content?.some(block=>{
      if(block.type!=='text') return false;
      try {const result=JSON.parse(block.text);return result.runId===runId && result.state==='completed' && typeof result.reportPath==='string';}
      catch {return false;}
    })===true;
  });
}

export function comparePairs(rows, baseline, candidate) {
  const tasks = [...new Set(rows.map(r => r.task))];
  const pairs = tasks.map(task => {
    const a = rows.filter(r => r.task === task && r.arm === baseline);
    const b = rows.filter(r => r.task === task && r.arm === candidate);
    if (a.length !== 1 || b.length !== 1) return { task, comparable: false, reason: 'missing-or-duplicate-arm' };
    const left = a[0], right = b[0];
    if (!left.complete || !right.complete || left.quality?.passed !== true || right.quality?.passed !== true) return { task, comparable: false, reason: 'incomplete-or-quality-failure' };
    if ([left, right].some(row => ['observedAgentTokens', 'uncachedInputTokens', 'outputTokens'].some(field => !Number.isSafeInteger(row.usage?.[field]) || row.usage[field] < 0))) return { task, comparable: false, reason: 'missing-or-invalid-usage' };
    const metric = field => {
      const base = left.usage?.[field], actual = right.usage?.[field];
      if (!Number.isFinite(base) || !Number.isFinite(actual)) return null;
      return { baseline: base, candidate: actual, saved: base - actual, savedPercent: base === 0 ? null : (base - actual) / base * 100 };
    };
    return { task, comparable: true, agentTokens: metric('observedAgentTokens'), uncachedInput: metric('uncachedInputTokens'), output: metric('outputTokens') };
  });
  return { baseline, candidate, pairs, claim: 'Paired observations only; no estimate of web tokens, money, quota or general savings.' };
}
