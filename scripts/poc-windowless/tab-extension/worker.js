// Intentionally restricted to the intercepted fixture origin. The harness
// invokes these functions in the worker; a product bridge is not implemented.
globalThis.openReview = async windowId => chrome.tabs.create({
  windowId, url: 'about:blank', active: false,
});
globalThis.submitReview = async tabId => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url !== 'https://giviloop-poc.test/') throw new Error('Unexpected tab origin.');
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Synthetic review request');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('button').click();
    },
  });
};
globalThis.closeReview = tabId => chrome.tabs.remove(tabId);
globalThis.activeTabs = () => chrome.tabs.query({ active: true, windowType: 'normal' });
globalThis.windowIds = async () => (await chrome.windows.getAll()).map(w => w.id).sort();
