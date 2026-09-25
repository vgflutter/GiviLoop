// Opt-in real website tests. Sends only the synthetic source below, never this repository.
// node scripts/web-acceptance.mjs --provider chatgpt-web [--browser-profile PATH]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { values } = parseArgs({ options: { provider: { type: 'string' }, 'browser-profile': { type: 'string' } } });
const provider = values.provider ?? 'chatgpt-web';
assert.ok(['chatgpt-web','gemini-web','deepseek-web','claude-web'].includes(provider));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.giviloop/diagnostics/web-acceptance', new Date().toISOString().replaceAll(':','-') + '-' + provider);
mkdirSync(output, { recursive: true });
const repo = mkdtempSync(path.join(os.tmpdir(), 'giviloop-acceptance-'));
const files = ['inventory.mjs','catalog.mjs','pagination.mjs'];
const inventory = `// Contract: stock is a Map of SKU -> nonnegative safe integer units.
// Each requested quantity is a positive safe integer; aggregated totals are safe integers.
// A reservation either deducts ALL requested quantities, or throws without changing ANY stock.
// Repeated SKUs must be aggregated; an empty request succeeds without mutation.
export function reserve(stock, lines) {
  const demand = new Map();
  for (const { sku, quantity } of lines) demand.set(sku, (demand.get(sku) ?? 0) + quantity);
  for (const [sku, quantity] of demand) {
    if ((stock.get(sku) ?? 0) < quantity) throw new Error('insufficient stock');
  }
  for (const [sku, quantity] of demand) stock.set(sku, stock.get(sku) - quantity);
  return true;
}
`;
const brokenInventory = inventory.replace("  }\n  for (const [sku, quantity] of demand) stock.set(sku, stock.get(sku) - quantity);", "    stock.set(sku, stock.get(sku) - quantity);\n  }");
const catalog = `// Contract: tenant and resource IDs are arbitrary nonempty strings; values are strings.
// Different tenants/resources must never share cached values. Entries expire at now >= expiresAt.
// now and ttl are nonnegative safe integers and now + ttl is a safe integer.
function key(tenant, resource) { return JSON.stringify([tenant, resource]); }
export class CatalogCache {
  #entries = new Map();
  set(tenant, resource, value, now, ttl) {
    this.#entries.set(key(tenant, resource), { value, expiresAt: now + ttl });
  }
  get(tenant, resource, now) {
    const entry = this.#entries.get(key(tenant, resource));
    if (!entry || now >= entry.expiresAt) return undefined;
    return entry.value;
  }
}
`;
const brokenCatalog = catalog.replace('JSON.stringify([tenant, resource])', 'resource');
const pagination = `// Contract: offset and limit are nonnegative safe integers, their sum is safe.
// Defaults apply only to undefined. A limit of zero returns []; input is never mutated.
export function page(items, { offset = 0, limit = 20 } = {}) {
  return items.slice(offset, offset + limit);
}
`;
const refactoredPagination = pagination.replace('  return items.slice(offset, offset + limit);', '  const end = offset + limit;\n  return items.slice(offset, end);');
// Git's ordinary diff context can omit unchanged contracts above the hunk.
// Supply the same declared preconditions explicitly, without hinting at the bugs.
const contracts = [[files[0], inventory], [files[1], catalog], [files[2], pagination]]
  .map(([name, source]) => `${name}:\n${source.split('\n').filter(line => line.startsWith('//')).join('\n')}`)
  .join('\n\n');
const writeSources = broken => {
  for (const [name, source] of [[files[0], broken ? brokenInventory : inventory], [files[1], broken ? brokenCatalog : catalog], [files[2], refactoredPagination]]) writeFileSync(path.join(repo,name),source);
};
const snapshot = () => Object.fromEntries(files.map(name => [name, createHash('sha256').update(readFileSync(path.join(repo,name))).digest('hex')]));
async function independentChecks(phase) {
  const { reserve } = await import(pathToFileURL(path.join(repo,files[0])).href + '?phase=' + phase);
  const { CatalogCache } = await import(pathToFileURL(path.join(repo,files[1])).href + '?phase=' + phase);
  const { page } = await import(pathToFileURL(path.join(repo,files[2])).href + '?phase=' + phase);
  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({ name, passed:true }); } catch { checks.push({ name, passed:false }); } };
  check('successful multi-SKU reservation', () => { const s=new Map([['a',5],['b',4]]); assert.equal(reserve(s,[{sku:'a',quantity:2},{sku:'b',quantity:3}]),true); assert.deepEqual([...s],[['a',3],['b',1]]); });
  check('rollback when a later SKU is unavailable', () => { const s=new Map([['a',5],['b',0]]); assert.throws(()=>reserve(s,[{sku:'a',quantity:2},{sku:'b',quantity:1}])); assert.deepEqual([...s],[['a',5],['b',0]]); });
  check('rollback when a later SKU does not exist', () => { const s=new Map([['a',5]]); assert.throws(()=>reserve(s,[{sku:'a',quantity:2},{sku:'missing',quantity:1}])); assert.deepEqual([...s],[['a',5]]); });
  check('aggregate repeated SKUs on success', () => { const s=new Map([['a',5]]); reserve(s,[{sku:'a',quantity:2},{sku:'a',quantity:3}]); assert.equal(s.get('a'),0); });
  check('aggregate repeated SKUs before rejecting', () => { const s=new Map([['a',5]]); assert.throws(()=>reserve(s,[{sku:'a',quantity:3},{sku:'a',quantity:3}])); assert.equal(s.get('a'),5); });
  check('empty reservation', () => { const s=new Map([['a',5]]); assert.equal(reserve(s,[]),true); assert.equal(s.get('a'),5); });
  check('missing first SKU', () => { const s=new Map(); assert.throws(()=>reserve(s,[{sku:'a',quantity:1}])); assert.equal(s.size,0); });
  check('cache tenant isolation', () => { const c=new CatalogCache(); c.set('one','sku','private-one',0,10); assert.equal(c.get('two','sku',1),undefined); });
  check('cache tenant overwrite isolation', () => { const c=new CatalogCache(); c.set('one','sku','one',0,10); c.set('two','sku','two',0,10); assert.equal(c.get('one','sku',1),'one'); });
  check('cache IDs containing separators', () => { const c=new CatalogCache(); c.set('a:b','c','one',0,10); c.set('a','b:c','two',0,10); assert.equal(c.get('a:b','c',1),'one'); });
  check('cache before expiration', () => { const c=new CatalogCache(); c.set('t','r','v',10,5); assert.equal(c.get('t','r',14),'v'); });
  check('cache exact expiration', () => { const c=new CatalogCache(); c.set('t','r','v',10,5); assert.equal(c.get('t','r',15),undefined); });
  check('cache zero TTL', () => { const c=new CatalogCache(); c.set('t','r','v',10,0); assert.equal(c.get('t','r',10),undefined); });
  check('cache empty string value', () => { const c=new CatalogCache(); c.set('t','r','',10,5); assert.equal(c.get('t','r',11),''); });
  check('pagination zero limit', () => assert.deepEqual(page([1,2,3],{limit:0}),[]));
  check('pagination defaults', () => assert.deepEqual(page([1,2,3]),[1,2,3]));
  check('pagination offset', () => assert.deepEqual(page([1,2,3],{offset:1,limit:1}),[2]));
  check('pagination does not mutate', () => { const a=[1,2,3]; page(a,{offset:1,limit:1}); assert.deepEqual(a,[1,2,3]); });
  const failed=checks.filter(c=>!c.passed).map(c=>c.name);
  assert.deepEqual(failed, phase==='buggy' ? ['rollback when a later SKU is unavailable','rollback when a later SKU does not exist','cache tenant isolation','cache tenant overwrite isolation'] : []);
  return checks;
}
const client = new Client({name:'giviloop-web-acceptance',version:'1.0.0'});
const results = [];
const call = async (name,args) => {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:240000});
  assert.notEqual(result.isError,true,JSON.stringify(result)); return result;
};
const question='Rispondi in italiano, entro 700 parole. Controlla i comportamenti rispetto ai contratti dichiarati nei file. Segnala solo bug concreti: file/funzione, input che li riproduce, risultato atteso e attuale, correzione minima e test. Le modifiche possono anche essere corrette: evita consigli stilistici o richieste di validazione fuori contratto. Se non trovi bug confermati, scrivi NO_CONFIRMED_FINDINGS. Indica separatamente eventuali dubbi non dimostrati. Non usare strumenti o servizi esterni.';
try {
  writeSources(false); writeFileSync(path.join(repo,files[2]),pagination);
  for (const args of [['init'],['add','.'],['-c','user.name=GiviLoop fixture','-c','user.email=fixture@example.invalid','commit','-m','Known-correct synthetic baseline']]) execFileSync('git',args,{cwd:repo,stdio:'ignore'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(path.join(root,'test/fixtures/live-diagnostics.mjs')).href,path.join(root,'dist/mcp-server.js')],env:{...process.env,GIVILOOP_ALLOWED_REPOSITORIES:repo,GIVILOOP_SYNTHETIC_DIAGNOSTICS:output},stderr:'pipe'}));
  for (const phase of ['buggy','fixed']) {
    writeSources(phase==='buggy');
    const checks=await independentChecks(phase), before=snapshot();
    const started=Date.now();
    if(phase==='buggy') {
      await call('givi_prepare_from_git',{repositoryPath:repo,targetProvider:provider.replace('-web','-chat'),taskGoal:question+'\n\nDeclared contracts (including unchanged lines outside diff hunks):\n'+contracts});
      writeFileSync(path.join(output,'buggy-diff.patch'),execFileSync('git',['diff'],{cwd:repo,encoding:'utf8'}));
    }
    const delivery={repositoryPath:repo,webProvider:provider,mode:'auto',background:true,verificationWaitMs:0,maxWaitMs:180000,reviewResponseMode:'analyze-only',...(values['browser-profile']?{browserProfile:path.resolve(values['browser-profile'])}:{})};
    await call(phase==='buggy'?'givi_send_to_web_llm':'givi_ask_web_llm',phase==='buggy'?delivery:{...delivery,question,attachedFiles:files});
    const runId=readFileSync(path.join(repo,'.giviloop/latest-run-id'),'utf8').trim();
    const dir=path.join(repo,'.giviloop/runs',runId);
    const response=readFileSync(path.join(dir,'external-review-response.md'),'utf8');
    const status=JSON.parse(readFileSync(path.join(dir,'browser-status.json'),'utf8'));
    const read=await call('givi_read_external_review',{repositoryPath:repo,runId,reviewResponseMode:'analyze-only'});
    assert.ok(read.content.some(c=>c.type==='text'&&c.text.includes(response)));
    assert.deepEqual(snapshot(),before);assert.equal(status.outcome,'completed');assert.equal(status.submitted,true);assert.equal(status.provider,provider);
    const result={provider,phase,runId,elapsedMs:Date.now()-started,sourceUnchanged:true,checks,verificationRequired:status.verificationRequired,responseCharacters:response.length,transportPassed:true,semanticAssessment:'Read response; pipeline success alone does not score review accuracy.'};
    results.push(result);
    writeFileSync(path.join(output,phase+'-response.md'),response);
    writeFileSync(path.join(output,phase+'-status.json'),JSON.stringify(status,null,2));
    writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(result));
  }
  assert.ok(readFileSync(path.join(output,'page-diagnostics.jsonl'),'utf8').includes('"event":"state"'), 'Live diagnostics must observe the actual review page');
} catch(error) {
  writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),completedPhases:results.length},null,2));
  // Keep delivery evidence before removing the fixture, including uncertain sends.
  try {
    const runId=readFileSync(path.join(repo,'.giviloop/latest-run-id'),'utf8').trim();
    const status=readFileSync(path.join(repo,'.giviloop/runs',runId,'browser-status.json'),'utf8');
    writeFileSync(path.join(output,'failure-browser-status.json'),status);
  } catch { /* Failure can precede run/status creation. */ }
  throw error;
} finally { await client.close();rmSync(repo,{recursive:true,force:true});console.log('Evidence: '+output); }
