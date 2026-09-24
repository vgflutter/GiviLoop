let creating;
globalThis.giviloopOffscreen = { ready: false };
async function ensureDocument() {
  if (creating) return creating;
  creating = (async () => {
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url],
    });
    if (!contexts.length) await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['DOM_PARSER'],
      justification: 'Parse review HTML fragments in a local document without opening a window.',
    });
    const parsed = await chrome.runtime.sendMessage({
      type: 'parse-review-fragment', html: '<p>GiviLoop ready</p>',
    });
    if (parsed?.text !== 'GiviLoop ready') throw new Error('Offscreen parser did not initialize.');
    globalThis.giviloopOffscreen = { ready: true };
  })();
  try { await creating; } finally { creating = undefined; }
}
const start = () => ensureDocument().catch(() => {
  globalThis.giviloopOffscreen = { ready: false, failed: true };
});
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
start();
