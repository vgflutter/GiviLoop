let creating;
globalThis.pocStatus = { stage: 'starting' };
async function ensureDocument() {
  if (creating) return creating;
  creating = (async () => {
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (!contexts.length) await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['DOM_PARSER'],
      justification: 'Parse review HTML fragments in an isolated extension document without opening a window.',
    });
    const parsed = await chrome.runtime.sendMessage({ type: 'parse-review-fragment', html: '<p>synthetic review</p>' });
    if (parsed?.text !== 'synthetic review') throw new Error('Offscreen DOM parser did not return its local fixture result.');
    globalThis.pocStatus = { stage: 'ready', existingDocument: contexts.length > 0, parserVerified: true };
  })();
  try { await creating; } finally { creating = undefined; }
}
const start = () => ensureDocument().catch(error => { globalThis.pocStatus = { stage: 'failed', error: error.message }; });
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
start();
