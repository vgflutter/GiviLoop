import type { Locator, Page } from "playwright";
import { assertChatOrigin, BrowserRunError, chatInput, pageBlocker } from "./browser-runtime.js";
import { WEB_CONFIG, type WebProvider } from "./web-config.js";

type OtherProvider = Exclude<WebProvider, "chatgpt-web">;

// Only the final assistant content is collected. User messages, thinking panes,
// citations/toolbars and earlier turns are never used as a response fallback.
export function otherMessages(page: Page, provider: OtherProvider): Locator {
  switch (provider) {
    case "deepseek-web": return page.locator('.ds-message:has(.ds-markdown:not(.ds-think-content .ds-markdown))');
    case "claude-web": return page.locator('[data-is-streaming]:has(.font-claude-response)');
    case "gemini-web": return page.locator('model-response');
  }
}

export async function otherSendControl(page: Page, provider: OtherProvider): Promise<Locator> {
  if (provider === "deepseek-web") return chatInput(page, provider);
  const label = /^(Send message|Send Message|Send prompt|Invia messaggio|Invia prompt|Send|Invia)$/i;
  const button = page.getByRole("button", { name: label }).filter({ visible: true }).first();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const blocker = await pageBlocker(page, provider);
    if (blocker) throw blocker;
    if (await button.isEnabled({ timeout: 250 }).catch(() => false)) return button;
    await page.waitForTimeout(250);
  }
  throw new BrowserRunError("SEND_UNAVAILABLE", `No enabled ${WEB_CONFIG[provider].name} send button appeared. No prompt was sent.`);
}

export async function waitForOtherResponse(page: Page, provider: OtherProvider, options: {
  assistantMessagesBefore: number; responseStableMs: number; maxWaitMs: number;
}): Promise<string> {
  const deadline = Date.now() + options.maxWaitMs;
  let lastText = "", changedAt = Date.now();
  while (Date.now() < deadline) {
    const blocker = await pageBlocker(page, provider);
    if (blocker) throw blocker;
    assertChatOrigin(page, WEB_CONFIG[provider].url);
    const messages = otherMessages(page, provider);
    if (await messages.count() > options.assistantMessagesBefore) {
      const latest = messages.last();
      const content = latest.locator(provider === "gemini-web" ? 'message-content .markdown'
        : provider === "claude-web" ? '.font-claude-response' : '.ds-markdown:not(.ds-think-content .ds-markdown)').last();
      const text = (await content.innerText({ timeout: 250 }).catch(() => "")).trim();
      if (text !== lastText) { lastText = text; changedAt = Date.now(); }
      const stop = page.getByRole("button", { name: /^(Stop|Stop generating|Stop response|Interrompi|Interrompi generazione|Interrompi risposta)$/i }).filter({ visible: true });
      // Require a completion control on THIS response; stability alone is not
      // enough when a reasoning model pauses before continuing its answer.
      const copy = latest.getByRole("button", { name: /^(Copy|Copy response|Copy message|Copia|Copia risposta|Copia messaggio)$/i }).filter({ visible: true });
      const streaming = await latest.getAttribute("data-is-streaming") === "true";
      // DeepSeek also offers copy on user messages. Require an assistant-only
      // regeneration action before accepting a message as the final answer.
      const assistantConfirmed = provider !== "deepseek-web" || await latest.getByRole("button", {
        name: /^(Regenerate|Regenerate response|Retry|Rigenera|Riprova|重新生成)$/i,
      }).count() > 0;
      if (lastText && assistantConfirmed && !streaming && await copy.count() > 0 && await stop.count() === 0 && Date.now() - changedAt >= options.responseStableMs) return lastText;
    }
    await page.waitForTimeout(500);
  }
  throw new BrowserRunError(lastText ? "RESPONSE_INCOMPLETE" : "RESPONSE_TIMEOUT",
    `No completed ${WEB_CONFIG[provider].name} answer could be confirmed. The prompt was sent; check the conversation before retrying. No response was saved.`);
}
