// Loaded only by the public synthetic acceptance runner, never by the product.
// No cookies, headers, request/response bodies, HTML or URL query strings.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { nativeChrome } from '../../dist/providers/native-chrome.js';

const output = process.env.GIVILOOP_SYNTHETIC_DIAGNOSTICS;
if (output) {
  const write = event => appendFileSync(path.join(output, 'page-diagnostics.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  const launch = nativeChrome.launch;
  nativeChrome.launch = async (...args) => {
    const context = await launch(...args);
    let number = 0;
    const observe = page => {
      const id = ++number;
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.hostname === 'chatgpt.com' && (response.status() >= 400 || /conversation|sentinel/.test(url.pathname))) {
          write({ id, event: 'http', path: url.pathname.replace(/[a-f0-9-]{24,}/gi, ':id'), status: response.status() });
        }
      });
      let busy = false;
      const sample = async () => {
        if (busy || page.isClosed() || !page.url().startsWith('https://chatgpt.com/')) return;
        busy = true;
        try {
          const state = await page.evaluate(() => ({
            ready: document.readyState, visibility: document.visibilityState,
            // Only a fresh anonymous profile and public test text reach this hook.
            text: document.body.innerText.slice(0, 30000),
            editors: [...document.querySelectorAll('textarea,[contenteditable="true"]')].map(node => {
              const box = node.getBoundingClientRect();
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return { tag: node.tagName, id: node.id, length: (node.value ?? node.innerText).length,
                hit: hit?.tagName, covered: !hit || !node.contains(hit), width: box.width, height: box.height };
            }),
            messages: [...document.querySelectorAll('[data-message-role],[data-message-author-role]')].map(node => ({
              role: node.getAttribute('data-message-role') ?? node.getAttribute('data-message-author-role'),
              complete: node.getAttribute('data-message-complete'), length: node.innerText.length,
            })),
          }));
          write({ id, event: 'state', ...state });
        } catch { /* Navigation or cleanup can destroy the execution context. */ }
        finally { busy = false; }
      };
      const timer = setInterval(() => void sample(), 2000);
      timer.unref();
      page.once('close', () => clearInterval(timer));
      const close = context.close.bind(context);
      context.close = async (...closeArgs) => { clearInterval(timer); await sample(); return close(...closeArgs); };
    };
    context.pages().forEach(observe);
    context.on('page', observe);
    return context;
  };
}
