import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenMetrics, comparePairs, hasScopedExport } from '../scripts/benchmarks/token-metrics.mjs';
import { TASKS } from '../scripts/benchmarks/token-tasks.mjs';
import { publicReport, markdownReport } from '../scripts/benchmarks/token-report.mjs';

const completion = (overrides={}) => ({type:'turn.completed',usage:{input_tokens:1000,cached_input_tokens:800,output_tokens:200,...overrides}});
test('completed transport is not enough: export must succeed for the exact review',()=>{
  const event={type:'item.completed',item:{type:'mcp_tool_call',server:'giviloop',tool:'givi_export_report',status:'completed',arguments:{runId:'review-a'},result:{content:[{type:'text',text:JSON.stringify({runId:'review-a',state:'completed',reportPath:'report.md'})}]}}};
  assert.equal(hasScopedExport([event],'review-a'),true);
  assert.equal(hasScopedExport([event],'review-b'),false);
  for(const change of [e=>e.item.result.isError=true,e=>e.item.result.content[0].text='{}',e=>e.item.status='failed',e=>delete e.item.arguments.runId]) {
    const bad=structuredClone(event);change(bad);assert.equal(hasScopedExport([bad],'review-a'),false);
  }
});
test('token accounting does not double-count cache or reasoning, and leaves unobserved costs unknown',()=>{
  const result=tokenMetrics([completion({reasoning_output_tokens:150,cache_write_input_tokens:100})]);
  assert.equal(result.observedAgentTokens,1200);
  assert.equal(result.uncachedInputTokens,200);
  assert.equal(result.reasoningOutputTokens,150);
  for(const key of ['webReviewerTokens','totalWorkflowTokens','billedCost','subscriptionQuotaUsed']) assert.equal(result[key],null);
  assert.equal(tokenMetrics([completion()]).reasoningOutputTokens,null);
});
test('missing, failed, cumulative or impossible usage is not reported as zero',()=>{
  for(const events of [[],[completion(),completion()],[completion(),{type:'turn.failed'}],[{type:'turn.completed'}],
    [completion({input_tokens:-1})],[completion({cached_input_tokens:1001})],[completion({output_tokens:NaN})],
    [completion({reasoning_output_tokens:201})],[completion({cache_write_input_tokens:201})]]) assert.throws(()=>tokenMetrics(events));
});
const row=(arm,tokens=1200,extra={})=>({task:'same-task',arm,complete:true,quality:{passed:true},usage:{observedAgentTokens:tokens,uncachedInputTokens:200,outputTokens:200},...extra});
test('paired comparison preserves negative savings and zero baselines',()=>{
  const result=comparePairs([row('baseline'),row('candidate',1500)],'baseline','candidate').pairs[0];
  assert.equal(result.agentTokens.saved,-300);assert.equal(result.agentTokens.savedPercent,-25);
  assert.equal(comparePairs([row('baseline',0),row('candidate',100)],'baseline','candidate').pairs[0].agentTokens.savedPercent,null);
});
test('incomplete, lower-quality, missing and duplicate arms cannot establish savings',()=>{
  for(const candidates of [[],[row('candidate',0,{complete:false})],[row('candidate',0,{quality:{passed:false}})],
    [row('candidate'),row('candidate')],[row('candidate',0,{usage:{}})]]) {
    assert.equal(comparePairs([row('baseline'),...candidates],'baseline','candidate').pairs[0].comparable,false);
  }
});
test('public report uses an allowlist and preserves failed attempts without publishing private diagnostics',()=>{
  const report=publicReport({metadata:{startedAt:'2026-09-27',secret:'do-not-publish'},rows:[row('normal',1200,{elapsedMs:1000,error:'do-not-publish',review:{attempts:1,runs:[{state:'needs-attention',responseAvailable:false,profile:'do-not-publish'}]}}),row('giviloop',100,{elapsedMs:2000,complete:false})]});
  assert.doesNotMatch(JSON.stringify(report),/do-not-publish/);
  assert.equal(report.rows.length,2);
  assert.match(markdownReport(report),/not comparable/);
});
test('allocation oracle accepts integer remainder allocation and rejects rounded/biased implementations',async()=>{
  const allocate=(total,weights)=>{
    const effective=weights.some(Boolean)?weights:weights.map(()=>1), sum=effective.reduce((a,b)=>a+b,0);
    const shares=effective.map(w=>Math.floor(total*w/sum));
    const order=effective.map((w,i)=>({i,r:total*w%sum})).sort((a,b)=>b.r-a.r||a.i-b.i);
    const left=total-shares.reduce((a,b)=>a+b,0);for(let i=0;i<left;i++)shares[order[i].i]++;
    return shares;
  };
  assert.deepEqual(await TASKS[0].grade({allocate}),{passed:true,cases:27});
  await assert.rejects(()=>TASKS[0].grade({allocate:(total,w)=>w.map(x=>Math.round(total*x/w.reduce((a,b)=>a+b,0)))}));
});
test('cache oracle catches boundary, recency, expiry refresh and undefined-value regressions',async()=>{
  const factory=(mutation)=>(opts)=>{
    const data=new Map();const purge=()=>{for(const [k,e] of data)if(mutation==='expiry-boundary'?opts.now()>e.expires:opts.now()>=e.expires)data.delete(k);};
    const cache={
      set(k,v){purge();data.delete(k);data.set(k,{v,expires:opts.now()+opts.ttlMs});if(data.size>opts.capacity)data.delete(data.keys().next().value);},
      get(k){purge();const e=data.get(k);if(!e)return undefined;data.delete(k);if(mutation==='get-refresh')e.expires=opts.now()+opts.ttlMs;data.set(k,e);return e.v;},
      has(k){purge();if(mutation==='has-recency')cache.get(k);return mutation==='undefined-miss'?data.get(k)?.v!==undefined:data.has(k);},
      delete(k){purge();return data.delete(k);},size(){purge();return data.size;}
    };return cache;
  };
  assert.deepEqual(await TASKS[1].grade({createCache:factory()}),{passed:true,cases:10});
  for(const mutation of ['expiry-boundary','get-refresh','has-recency','undefined-miss']) await assert.rejects(()=>TASKS[1].grade({createCache:factory(mutation)}));
});
