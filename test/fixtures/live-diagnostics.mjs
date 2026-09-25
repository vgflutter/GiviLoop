// Loaded only by the public synthetic acceptance runner, never by the product.
// No cookies, headers, raw network bodies, page HTML or URL query strings.
// Editor text/markup belongs exclusively to our fresh synthetic test profile.
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
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) {
          const url = new URL(frame.url());
          write({ id, event: 'navigation', origin: url.origin, path: url.pathname.replace(/[a-f0-9-]{24,}/gi, ':id') });
        }
      });
      page.on('requestfailed', request => {
        const url = new URL(request.url());
        if (url.hostname === 'chatgpt.com') write({ id, event: 'request-failed',
          path: url.pathname.replace(/[a-f0-9-]{24,}/gi, ':id'), reason: request.failure()?.errorText });
      });
      page.on('response', async response => {
        const url = new URL(response.url());
        if (url.hostname === 'chatgpt.com' && (response.status() >= 400 || /conversation|sentinel/.test(url.pathname))) {
          write({ id, event: 'http', path: url.pathname.replace(/[a-f0-9-]{24,}/gi, ':id'), status: response.status() });
        }
        if (url.hostname === 'chatgpt.com' && /^\/(backend-anon\/f|unauth-mweb)\/conversation$/.test(url.pathname)) {
          try {
            const body = await response.text();
            const fields = new Set(), flags = new Set(), patchPaths = new Set(), contentPatches = []; let assistantCharacters = 0, records = 0;
            const inspect = (value, depth = 0) => {
              if (!value || typeof value !== 'object' || depth > 12) return;
              if (typeof value.p === 'string' && /^[a-z_0-9/]{1,160}$/i.test(value.p)) {
                patchPaths.add(value.p);
                if (/\bcontent\/parts(?:\/|$)/.test(value.p)) contentPatches.push({ path: value.p,
                  operation: typeof value.o === 'string' && /^[a-z_]{1,30}$/.test(value.o) ? value.o : undefined,
                  characters: typeof value.v === 'string' ? value.v.length : Array.isArray(value.v) ? value.v.filter(part => typeof part === 'string').join('').length : 0 });
              }
              if (value.author?.role === 'assistant') assistantCharacters += (value.content?.parts ?? []).filter(part => typeof part === 'string').join('').length;
              for (const [key, item] of Object.entries(value)) {
                if (/^[a-z_]{1,50}$/.test(key)) fields.add(key);
                if (['type','code','error_code','finish_reason','status','end_turn','role','channel','content_type'].includes(key) &&
                    (typeof item === 'boolean' || typeof item === 'string' && /^[a-z_ -]{1,70}$/i.test(item))) flags.add(`${key}:${item}`);
                inspect(item, depth + 1);
              }
            };
            for (const line of body.split('\n')) {
              if (!line.startsWith('data:')) continue;
              try { inspect(JSON.parse(line.slice(5))); records++; } catch { /* SSE terminator. */ }
            }
            write({ id, event: 'stream-summary', records, fields: [...fields], flags: [...flags], assistantCharacters, patchPaths: [...patchPaths], contentPatches });
          } catch { write({ id, event: 'stream-unavailable' }); }
        }
      });
      let pending;
      const collect = async () => {
        if (page.isClosed() || !page.url().startsWith('https://chatgpt.com/')) return;
        try {
          const state = await page.evaluate(() => ({
            ready: document.readyState, visibility: document.visibilityState,
            controls: [...document.querySelectorAll('button[data-testid],button[aria-label]')].map(node => ({
              testId: node.getAttribute('data-testid'), label: node.getAttribute('aria-label'), disabled: node.disabled,
            })),
            // Only a fresh anonymous profile and public test text reach this hook.
            text: document.body?.innerText?.slice(0, 30000),
            editors: [...document.querySelectorAll('textarea,[contenteditable="true"]')].map(node => {
              const box = node.getBoundingClientRect();
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return { tag: node.tagName, id: node.id, length: (node.value ?? node.innerText).length,
                text: node.value ?? node.innerText, markup: node.isContentEditable ? node.innerHTML : undefined,
                hit: hit?.tagName, covered: !hit || !node.contains(hit), width: box.width, height: box.height };
            }),
            messages: [...document.querySelectorAll('[data-message-role],[data-message-author-role]')].map(node => ({
              role: node.getAttribute('data-message-role') ?? node.getAttribute('data-message-author-role'),
              complete: node.getAttribute('data-message-complete'), length: node.innerText?.length,
              textContentLength: node.textContent?.length, display: getComputedStyle(node).display,
            })),
          }));
          write({ id, event: 'state', ...state });
        } catch (error) { write({ id, event: 'snapshot-error', error: String(error).slice(0, 400) }); }
      };
      const sample = () => pending ??= collect().finally(() => { pending = undefined; });
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
