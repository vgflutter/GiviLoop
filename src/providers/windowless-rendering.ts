import type { Page } from "playwright";

const prepared = new WeakMap<Page, Set<string>>();

// Serialized into the top-level review document. Hidden Chrome targets can
// report visibility=visible while never delivering animation frames. Keep the
// native callback when it arrives, otherwise deliver it after 100 ms. Do not
// change event trust, browser identity, authentication pages or child frames.
export function installWindowlessFrameFallback(origin: string): void {
  if (window.top !== window || location.origin !== origin) return;
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map<number, () => void>();
  window.requestAnimationFrame = callback => {
    if (typeof callback !== "function") return request(callback);
    let timer: number | undefined, done = false;
    const run = (time: number) => {
      if (done) return;
      done = true; window.clearTimeout(timer); pending.delete(id); callback(time);
    };
    const id = request(run);
    timer = window.setTimeout(() => { cancel(id); run(performance.now()); }, 100);
    pending.set(id, () => { done = true; window.clearTimeout(timer); });
    return id;
  };
  window.cancelAnimationFrame = id => { pending.get(id)?.(); pending.delete(id); cancel(id); };
}

export async function prepareWindowlessRendering(page: Page, providerUrl: string): Promise<void> {
  const origin = new URL(providerUrl).origin;
  const origins = prepared.get(page) ?? new Set<string>();
  if (origins.has(origin)) return;
  await page.addInitScript(installWindowlessFrameFallback, origin);
  origins.add(origin);
  prepared.set(page, origins);
}
