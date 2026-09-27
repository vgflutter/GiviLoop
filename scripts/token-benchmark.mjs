import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, openSync, closeSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { TASKS } from './benchmarks/token-tasks.mjs';
import { tokenMetrics, comparePairs, hasScopedExport } from './benchmarks/token-metrics.mjs';
import { publicReport, markdownReport } from './benchmarks/token-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {values:args}=parseArgs({options:{'run-live':{type:'boolean'},model:{type:'string'},effort:{type:'string'},provider:{type:'string'},'browser-profile':{type:'string'},out:{type:'string'},arms:{type:'string'}}});
const value = (flag, fallback) => args[flag.slice(2)] ?? fallback;
if (!args['run-live']) {
  console.log('Build first, then: node scripts/token-benchmark.mjs --run-live --model MODEL --effort EFFORT [--provider claude-web] [--browser-profile PATH] [--out PATH] [--arms normal,no-second-review,self-review,giviloop,giviloop-normal]\nBy default, runs ten real Codex tasks and four web reviews using your existing logins and quotas. Raw logs stay under ignored .giviloop/diagnostics. No API key required.');
  process.exit(0);
}
const model=value('--model'), effort=value('--effort'), provider=value('--provider','claude-web');
if (!model || !['minimal','low','medium','high','xhigh','max'].includes(effort)) throw new Error('Specify --model and a valid --effort explicitly.');
if (!['claude-web','chatgpt-web','deepseek-web','gemini-web'].includes(provider)) throw new Error('Unsupported web provider.');
const dir=path.resolve(value('--out',path.join(root,'.giviloop/diagnostics',`token-benchmark-${new Date().toISOString().replace(/[:.]/g,'-')}`)));
if (existsSync(dir)) throw new Error('Output already exists; refusing to overwrite or silently repeat runs.');
const {savePreferences}=await import('../dist/preferences.js');
const {configureAutoReview}=await import('../dist/auto-review.js');
const {runStatus}=await import('../dist/run-status.js');
const {readFindings}=await import('../dist/review-evidence.js');
mkdirSync(dir,{recursive:true});
const json=(file,data)=>writeFileSync(file,JSON.stringify(data,null,2)+'\n');
const armInstructions={
  normal:'',
  'no-second-review':'Do not perform a separate second review after implementation and tests, and do not call an external reviewer. Still run the required tests and fix failures.',
  'self-review':'After implementing and passing tests, perform one additional explicit review of your own diff against the requirements and edge cases. Fix any concrete issues you find and rerun relevant tests.',
  giviloop:'Use the configured automatic GiviLoop review as your additional review pass, instead of first doing a separate full self-review. Follow AGENTS.md: inspect scope, run checks, call givi_auto_review once, verify its claims, record findings and export the report for its exact runId. Fix confirmed issues and rerun relevant tests. Do not resend or fall back if the reviewer is unavailable.',
  'giviloop-normal':''
};
const selectedArms=value('--arms',Object.keys(armInstructions).join(',')).split(',');
if(new Set(selectedArms).size!==selectedArms.length || selectedArms.some(a=>!Object.hasOwn(armInstructions,a))) throw new Error('Unknown or duplicate arm.');
const metadata={startedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),host:execFileSync('codex',['--version'],{encoding:'utf8'}).trim(),model,effort,provider,node:process.version,platform:`${process.platform}/${process.arch}`,samplesPerArm:TASKS.length,webTokensAvailable:false,taskHashes:TASKS.map(t=>({task:t.id,sha256:createHash('sha256').update(t.request+t.source+t.starterTest).digest('hex')}))};
metadata.selectedArms=selectedArms;
json(path.join(dir,'metadata.json'),metadata);
const rows=[];
taskLoop: for (const [index,task] of TASKS.entries()) {
  const arms=[...selectedArms]; if(index%2) arms.reverse();
  for(const arm of arms) {
    const resultDir=path.join(dir,`${task.id}-${arm}`), repo=path.join(resultDir,'workspace');
    mkdirSync(repo,{recursive:true});
    const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    git('init');
    writeFileSync(path.join(repo,task.file),task.source);
    writeFileSync(path.join(repo,'task.test.mjs'),task.starterTest);
    writeFileSync(path.join(repo,'.gitignore'),'.giviloop/\n');
    writeFileSync(path.join(repo,'AGENTS.md'),'Work only in this repository. Use no dependencies or delegation. Implement the requested module as a self-contained file. Do not commit or publish.\n');
    if(arm.startsWith('giviloop')) {
      const browserProfile=value('--browser-profile');
      savePreferences(repo,{schemaVersion:1,provider,background:true,...(browserProfile?{browserProfile:path.resolve(browserProfile)}:{})});
      configureAutoReview(repo,'enable','codex');
    }
    git('add','.');git('-c','user.name=Benchmark','-c','user.email=benchmark@example.invalid','commit','-m','Public benchmark fixture');
    const prompt=`${task.request}\n\nWork only in this repository; do not read parent directories. Do not install dependencies, delegate, commit, or publish. Keep the implementation self-contained in ${task.file}. Give a concise final result.\n${armInstructions[arm]}`;
    writeFileSync(path.join(resultDir,'prompt.txt'),prompt+'\n');
    const out=openSync(path.join(resultDir,'events.jsonl'),'w'),err=openSync(path.join(resultDir,'stderr.log'),'w');
    const start=Date.now();console.log(`START ${task.id}/${arm}`);
    const child=spawn('codex',['exec','--json','--ephemeral','-C',repo,'--sandbox','workspace-write','-m',model,'-c',`model_reasoning_effort=${JSON.stringify(effort)}`,'-c','approval_policy="never"','-c',`projects.${JSON.stringify(repo)}.trust_level="trusted"`,'-o',path.join(resultDir,'final.txt'),prompt],{cwd:repo,stdio:['ignore',out,err]});
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},600000);
    const killTimer=setTimeout(()=>child.kill('SIGKILL'),610000);
    const exit=await new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',e=>resolve({error:e.message}));});
    clearTimeout(timeout);clearTimeout(killTimer);closeSync(out);closeSync(err);
    const row={task:task.id,arm,elapsedMs:Date.now()-start,exit,timedOut,complete:false};
    try {
      const events=readFileSync(path.join(resultDir,'events.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse);
      row.usage=tokenMetrics(events);
      const items=events.filter(e=>e.type==='item.completed').map(e=>e.item);
      row.commands=items.filter(i=>i?.type==='command_execution').length;
      row.mcpCalls=items.filter(i=>i?.type==='mcp_tool_call').map(i=>({server:i.server,tool:i.tool,status:i.status}));
      const grading=path.join(resultDir,'grading');mkdirSync(grading);
      copyFileSync(path.join(repo,task.file),path.join(grading,task.file));
      const grade=spawnSync(process.execPath,[path.join(root,'scripts/benchmarks/token-grade.mjs'),task.id,path.join(grading,task.file)],{encoding:'utf8',timeout:10000});
      row.quality=JSON.parse(grade.stdout.trim());
      row.complete=exit.code===0 && !timedOut;
      if(arm.startsWith('giviloop')) {
        const historyPath=path.join(repo,'.giviloop/auto-review/history.json');
        const history=existsSync(historyPath)?JSON.parse(readFileSync(historyPath,'utf8')):[];
        row.review={attempts:history.length,runs:history.map(h=>runStatus(repo,h.runId))};
        row.review.assessmentExported=history.length===1 && history.every(h=>hasScopedExport(events,h.runId) && existsSync(path.join(repo,'.giviloop/runs',h.runId,'double-check.md')));
        row.review.recordedFindings={confirmed:0,dismissed:0,unverified:0};
        for(const h of history) {
          if(!existsSync(path.join(repo,'.giviloop/runs',h.runId,'external-review-response.md'))) continue;
          for(const finding of readFindings(repo,h.runId).findings) row.review.recordedFindings[finding.effectiveStatus]++;
        }
        // Successful generation must be verified from saved state, not the final prose.
        row.complete &&= history.length===1 && row.review.assessmentExported && row.review.runs.every(r=>r.responseAvailable===true && r.state==='completed');
      }
    } catch(error) {row.error=error.message;row.complete=false;}
    writeFileSync(path.join(resultDir,'changes.patch'),git('diff','HEAD'));
    rows.push(row);json(path.join(resultDir,'result.json'),row);
    const summary={metadata,rows,comparisons:['normal','no-second-review','self-review','giviloop-normal'].map(a=>comparePairs(rows,a,'giviloop'))};
    json(path.join(dir,'summary.json'),summary);
    const publicResult=publicReport(summary);
    json(path.join(dir,'public-results.json'),publicResult);
    writeFileSync(path.join(dir,'report.md'),markdownReport(publicResult));
    console.log(`END ${task.id}/${arm} ${JSON.stringify({complete:row.complete,quality:row.quality,usage:row.usage,error:row.error})}`);
    if(!row.usage) {
      console.error('Stopped: no valid completed usage. Inspect this attempt before starting more sessions.');
      process.exitCode=1;break taskLoop;
    }
  }
}
console.log(`Results: ${path.relative(root,dir)}`);
