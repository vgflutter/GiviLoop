import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { distDir, fixture } from './helpers.mjs';

const { sendToWebChat } = await import(pathToFileURL(path.join(distDir,'providers/chatgpt-web.js')));
const { browserProfilePath } = await import(pathToFileURL(path.join(distDir,'providers/browser-runtime.js')));

for (const provider of ['deepseek-web','claude-web','gemini-web']) {
  test(`${provider}: rejects unsupported model selection and uploads before opening Chrome`, async t => {
    const f=fixture(t), profile=path.join(f.root,'must-not-be-created');
    assert.equal(f.cli('ask',['--question','Review','--target-provider',provider.replace('-web','-chat')]).status,0);
    const run=f.latest();
    for (const [options,code] of [[{model:'invented-model'},'MODEL_SELECTION_UNSUPPORTED'],[{attachmentPaths:['source.zip']},'ATTACHMENT_UNSUPPORTED']]) {
      await assert.rejects(sendToWebChat({webProvider:provider,repositoryPath:f.repo,requestPath:run.request,responsePath:run.response,userDataDir:profile,...options}),new RegExp(code));
      assert.equal(existsSync(profile),false);
      assert.equal(existsSync(run.response),false);
    }
  });
}

test('each browser provider has a separate default session profile', () => {
  const profiles=['chatgpt-web','deepseek-web','claude-web','gemini-web'].map(p=>browserProfilePath(p));
  assert.equal(new Set(profiles).size,4);
  assert.equal(browserProfilePath(),profiles[0]);
});

for (const [target, origin, name] of [['deepseek-chat','https://chat.deepseek.com/','DeepSeek'],['gemini-chat','https://gemini.google.com/app','Gemini']]) {
  test(`${target}: manual prepare/copy targets the correct chat without browser automation`, t => {
    const f=fixture(t,{git:true});
    const result=f.cli('prepare',['--goal','Review','--target-provider',target]);
    assert.equal(result.status,0,result.stderr);
    assert.match(readFileSync(f.latest().request,'utf8'),new RegExp(`You are ${name}`));
    const copied=f.cli('copy',['--open']);
    assert.equal(copied.status,0,copied.stderr);
    assert.match(copied.stdout,new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  });
}


test('an advisory run with only webProvider metadata keeps its destination across copy/ingest/send', t => {
  const f=fixture(t);
  assert.equal(f.cli('ask',['--question','Review']).status,0);
  const run=f.latest(), metadata=JSON.parse(readFileSync(run.metadata));
  delete metadata.targetProvider;
  metadata.webProvider='gemini-web';
  writeFileSync(run.metadata,JSON.stringify(metadata));
  const copied=f.cli('copy',['--open']);
  assert.equal(copied.status,0,copied.stderr);
  assert.match(copied.stdout,/https:\/\/gemini.google.com\/app/);
  writeFileSync(f.clipboard,'A manual answer');
  assert.equal(f.cli('ingest').status,0);
  assert.match(readFileSync(run.response,'utf8'),/Provider: gemini-chat/);
  const sent=f.cli('send',['--send','chatgpt-web']);
  assert.equal(sent.status,1);
  assert.match(sent.stderr,/targets gemini-chat/);
});
