import type { BrowserContext } from "playwright";
import { BrowserRunError, launchChatBrowser } from "./browser-runtime.js";

/** MCP-process-owned, exclusive leases. CLI never starts a background daemon. */
export class BrowserSessions {
  private entries = new Map<string, { ready: Promise<BrowserContext>; busy: boolean; timer?: NodeJS.Timeout; closing?: Promise<void> }>();
  private stopping = false;
  constructor(private readonly idleMs = 60_000, private readonly launch = (profile: string) => launchChatBrowser(profile, false, true)) {}
  async acquire(profile: string) {
    if (this.stopping) throw new BrowserRunError("BROWSER_CLOSED", "The MCP browser session manager is shutting down.");
    let entry = this.entries.get(profile);
    const reused = Boolean(entry);
    if (entry?.busy) throw new BrowserRunError("BROWSER_PROFILE_BUSY", "Another review is using this profile. Wait for it or choose another provider.");
    if (!entry) {
      if (this.entries.size >= 2) {
        throw new BrowserRunError("BROWSER_PROFILE_BUSY", "Two browser sessions are retained. Release idle sessions with givi_release_browser_sessions or wait up to 60 seconds.");
      }
      // Register synchronously before launch completes, to serialize a profile.
      entry = { ready: this.launch(profile), busy: true };
      this.entries.set(profile, entry);
    } else { entry.busy = true; clearTimeout(entry.timer); }
    const selected = entry;
    let context: BrowserContext;
    try {
      context = await selected.ready;
      if (this.stopping) throw new Error("MCP browser manager stopped during launch.");
      if (context.browser() && !context.browser()!.isConnected()) throw new Error("The retained browser disconnected. Retry the review before submission.");
    } catch (error) { await this.close(profile); throw error; }
    let released = false;
    return { context, reused, release: async (healthy: boolean) => {
      if (released) return; released = true;
      if (!healthy || this.stopping) { await this.close(profile); return; }
      selected.busy = false;
      selected.timer = setTimeout(() => { void this.close(profile).catch(() => {}); }, this.idleMs);
      selected.timer.unref();
    } };
  }
  async close(profile: string) {
    const entry = this.entries.get(profile);
    if (!entry) return;
    // Keep the lease occupied until real Chrome exit and cookie flush complete.
    entry.busy = true; clearTimeout(entry.timer);
    return entry.closing ??= (async () => {
      try { const context = await entry.ready; await context.close(); }
      finally { if (this.entries.get(profile) === entry) this.entries.delete(profile); }
    })();
  }
  async closeIdle(profile?: string) {
    if (profile && this.entries.get(profile)?.busy) throw new BrowserRunError("BROWSER_PROFILE_BUSY", "Another review is using this browser; wait before opening it.");
    const idle = [...this.entries].filter(([key, entry]) => !entry.busy && (!profile || profile === key));
    await Promise.all(idle.map(([key]) => this.close(key)));
    return { closed: idle.length, remaining: this.entries.size };
  }
  async closeAll() {
    this.stopping = true;
    await Promise.allSettled([...this.entries.keys()].map(profile => this.close(profile)));
  }
}
export const browserSessions = new BrowserSessions();
