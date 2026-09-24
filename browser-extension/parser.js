// Local DOM parsing only. No host permissions, remote pages or injected scripts.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'parse-review-fragment') return;
  if (typeof message.html !== 'string' || message.html.length > 100000) return;
  const parsed = new DOMParser().parseFromString(message.html, 'text/html');
  respond({ text: parsed.body.textContent });
});
