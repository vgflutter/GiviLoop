// Public report is an allowlist: never copy raw prompts, browser paths, tool
// results or account/session data from the private diagnostic directory.
import { comparePairs } from './token-metrics.mjs';

export function publicReport(summary) {
  const m=summary.metadata;
  const metadata=Object.fromEntries(['startedAt','sourceCommit','host','model','effort','provider','node','platform','samplesPerArm','webTokensAvailable','taskHashes','selectedArms'].map(k=>[k,m[k]]));
  const rows=summary.rows.map(r=>({task:r.task,arm:r.arm,complete:r.complete,elapsedMs:r.elapsedMs,
    quality:{passed:r.quality?.passed===true,cases:r.quality?.cases??null},
    usage:r.usage?Object.fromEntries(['inputTokens','cachedInputTokens','uncachedInputTokens','outputTokens','reasoningOutputTokens','observedAgentTokens'].map(k=>[k,r.usage[k]??null])):null,
    commands:r.commands??null,mcpCalls:r.mcpCalls?.map(c=>({tool:c.tool,status:c.status}))??[],
    review:r.review?{attempts:r.review.attempts,states:r.review.runs.map(s=>({state:s.state,responseAvailable:s.responseAvailable})),
      assessmentExported:r.review.assessmentExported??null,
      recordedFindings:r.review.recordedFindings?Object.fromEntries(['confirmed','dismissed','unverified'].map(k=>[k,r.review.recordedFindings[k]??0])):null}:null}));
  return {metadata,rows,comparisons:[...['normal','no-second-review','self-review','giviloop-normal'].map(a=>comparePairs(rows,a,'giviloop')),comparePairs(rows,'normal','no-second-review')],
    unknown:['Web reviewer tokens','Total workflow tokens','Actual money saved','Subscription quota consumed'],
    limits:'Two synthetic tasks; one observation per task/arm. No general savings rate or statistical significance. Failed and incomplete attempts remain visible.'};
}

export function markdownReport(report, {jsonFile='public-results.json',methodLink='https://github.com/vgflutter/GiviLoop/blob/main/docs/token-benchmark.md'}={}) {
  const n=x=>x===null||x===undefined?'unknown':Number(x).toLocaleString('en-US');
  const table=report.rows.map(r=>`| ${r.task} | ${r.arm} | ${r.complete&&r.quality.passed?'passed':'incomplete / failed'} | ${n(r.usage?.observedAgentTokens)} | ${n(r.usage?.uncachedInputTokens)} | ${n(r.usage?.outputTokens)} | ${n(Math.round(r.elapsedMs/1000))} |`).join('\n');
  const deltas=report.comparisons.flatMap(c=>c.pairs.map(p=>`| ${p.task} | ${c.baseline} → ${c.candidate} | ${p.comparable&&p.agentTokens?`${n(p.agentTokens.saved)} (${p.agentTokens.savedPercent?.toFixed(1)??'n/a'}%)`:'not comparable'} |`)).join('\n');
  return `# Agent token pilot — ${report.metadata.startedAt.slice(0,10)}\n\nSource: \`${report.metadata.sourceCommit}\`; Codex \`${report.metadata.host}\`, model \`${report.metadata.model}\`, effort \`${report.metadata.effort}\`; reviewer \`${report.metadata.provider}\`.\n\nCurrent source checkout, not a validation of a published release. Existing Codex login; no API-billed control. The web model was not pinned.\n\n| Task | Arm | Independent checks / workflow | Agent input + output | Uncached input | Output | Seconds |\n| --- | --- | --- | ---: | ---: | ---: | ---: |\n${table}\n\n## Paired observed-agent-token deltas\n\nPositive values mean fewer observed agent tokens in the candidate; negative values mean more. Cached input is included in the aggregate above; it does not have the same cost as uncached input.\n\n| Task | Baseline → candidate | Tokens saved (percentage of baseline) |\n| --- | --- | ---: |\n${deltas}\n\n${report.limits}\n\nWeb tokens, total workflow tokens, money and quota consumption remain unknown. These results do not establish that an agent always performs a default second review.\n\n[Method and reproduction](${methodLink}). [Machine-readable results](${jsonFile}).\n`;
}
