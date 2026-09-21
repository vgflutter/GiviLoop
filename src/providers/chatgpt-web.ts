import { type BrowserContext, type Locator, type Page } from "playwright";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { assertChatOrigin, atomicWrite, BrowserRunError, browserProfilePath, chatInput, launchChatBrowser, minimizeBrowser, navigateToChat, pageBlocker, showBrowser, verificationTimeout, waitForChatInput } from "./browser-runtime.js";
import { assertRepositoryAllowedForExternalTransfer } from "./external-transfer.js";
import { acquireRunLock } from "../run-lock.js";

export type ChatGptWebMode = "prefill" | "submit" | "auto";
export type ChatGptModelSelection = "prefer" | "require";

export type ChatGptWebOptions = {
  repositoryPath: string;
  requestPath?: string;
  responsePath?: string;
  attachmentPaths?: string[];
  mode?: ChatGptWebMode;
  headless?: boolean;
  background?: boolean;
  model?: string;
  modelSelection?: ChatGptModelSelection;
  chatGptUrl?: string;
  userDataDir?: string;
  responseStableMs?: number;
  maxWaitMs?: number;
  navigationTimeoutMs?: number;
  verificationWaitMs?: number;
  signal?: AbortSignal;
};

export type ChatGptWebResult = {
  mode: ChatGptWebMode;
  requestPath: string;
  attachmentPaths: string[];
  responsePath?: string;
  responseText?: string;
  modelSelectionWarning?: string;
};

const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
const DEFAULT_RESPONSE_STABLE_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 180_000;

export async function sendToChatGptWeb(
  options: ChatGptWebOptions,
): Promise<ChatGptWebResult> {
  const repositoryPath = path.resolve(options.repositoryPath);
  assertRepositoryAllowedForExternalTransfer(repositoryPath);

  const requestPath =
    options.requestPath ??
    path.join(
      repositoryPath,
      ".giviloop",
      "outbox",
      "external-review-request.md",
    );

  const responsePath =
    options.responsePath ??
    path.join(
      repositoryPath,
      ".giviloop",
      "inbox",
      "external-review-response.md",
    );

  const mode = options.mode ?? "prefill";
  const headless = options.headless ?? false;
  const background = options.background ?? false;
  const providerUrl = options.chatGptUrl ?? DEFAULT_CHATGPT_URL;
  const verificationWaitMs = verificationTimeout(options.verificationWaitMs, headless);

  if (headless && mode !== "auto") {
    throw new Error(
      "Headless browsing requires mode=auto (--mode auto). Use a visible browser for prefill or submit.",
    );
  }

  if (background && (headless || mode !== "auto")) {
    throw new Error("Background browsing requires mode=auto and cannot be combined with headless. Use --background --mode auto.");
  }

  if (!existsSync(requestPath)) {
    throw new Error(`Request file not found: ${requestPath}`);
  }

  const requestText = readFileSync(requestPath, "utf8");

  if (!requestText.trim()) {
    throw new Error(`Request file is empty: ${requestPath}`);
  }

  const attachmentPaths = (options.attachmentPaths ?? []).map((attachmentPath) =>
    path.resolve(attachmentPath),
  );
  for (const attachmentPath of attachmentPaths) {
    if (!existsSync(attachmentPath)) {
      throw new Error(`Attachment file not found: ${attachmentPath}`);
    }
  }

  const userDataDir = path.resolve(options.userDataDir ?? browserProfilePath());
  const statusPath = path.join(path.dirname(responsePath), "browser-status.json");
  const status = {
    startedAt: new Date().toISOString(), endedAt: undefined as string | undefined,
    mode, headless, background, transport: headless ? "playwright" : "native-cdp", profile: userDataDir,
    requestSha256: createHash("sha256").update(requestText).digest("hex"),
    phase: "launching", outcome: "running", submitted: false as boolean | "unknown",
    errorCode: undefined as string | undefined,
    verificationRequired: false, verificationCompleted: false,
  };
  function record(phase: string): void {
    status.phase = phase;
    atomicWrite(statusPath, JSON.stringify(status, null, 2) + "\n");
  }
  const release = acquireRunLock(path.dirname(responsePath), "chatgpt-web");
  let context: BrowserContext | undefined;
  let keepOpen = false;
  let operationFailed = false;
  let closePromise: Promise<void> | undefined;
  const cancelledError = () => new BrowserRunError("BROWSER_CANCELLED", "The browser review was cancelled. Its browser context was closed; no new response was saved. Check the run's submitted status before retrying.");
  function checkCancelled(): void {
    if (options.signal?.aborted) throw cancelledError();
  }
  function closeContext(): Promise<void> {
    if (!context) return Promise.resolve();
    const ownedContext = context;
    return closePromise ??= Promise.resolve().then(() => ownedContext.close());
  }
  // Closing this run's context interrupts Playwright waits without touching any
  // other browser. A cancellation during launch is checked as soon as it returns.
  const cancel = () => { void closeContext().catch(() => {}); };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    record("launching");
    checkCancelled();
    context = await launchChatBrowser(userDataDir, headless, background);
    checkCancelled();
    const page = await createFreshPage(context);
    if (background) await minimizeBrowser(context, page);
    record("navigating");
    await navigateToChat(page, providerUrl, options.navigationTimeoutMs ?? 20_000, verificationWaitMs, async () => {
      checkCancelled();
      status.verificationRequired = true;
      record("waiting-for-verification");
      await showBrowser(context!, page);
      console.error(`GiviLoop: complete the browser's human verification in the Chrome window. Waiting up to ${Math.ceil(verificationWaitMs / 1000)} seconds; the same request will resume automatically. No prompt has been sent.`);
    });
    checkCancelled();
    if (status.verificationRequired) {
      status.verificationCompleted = true;
      if (background) await minimizeBrowser(context, page);
    }
    record("waiting-for-input");
    await waitForChatInput(page, 15_000);
    checkCancelled();
    assertChatOrigin(page, providerUrl);
    record("selecting-model");
    const modelSelectionWarning = options.model
      ? await maybeSelectChatGptModel(page, {
          model: options.model,
          modelSelection: options.modelSelection ?? "prefer",
        })
      : undefined;
    if (options.model) await waitForChatInput(page, 15_000);
    checkCancelled();
    if (attachmentPaths.length > 0) {
      record("uploading");
      await uploadAttachments(page, attachmentPaths, providerUrl);
    }
    record("filling");
    checkCancelled();
    assertChatOrigin(page, providerUrl);
    await fillChatInput(page, requestText);
    checkCancelled();
    if (mode === "prefill") {
      status.outcome = "prefilled";
      status.endedAt = new Date().toISOString();
      record("prefilled");
      keepOpen = true;
      return { mode, requestPath, attachmentPaths, modelSelectionWarning };
    }
    const assistantMessagesBefore = await countAssistantMessages(page);
    record("waiting-for-send");
    const button = await waitForSendButton(page);
    checkCancelled();
    assertChatOrigin(page, providerUrl);
    // A click can have reached the server even if Playwright loses the page.
    // Never retry a click or navigation after this point.
    status.submitted = "unknown";
    record("submitting");
    try { await button.click({ timeout: 10_000 }); }
    catch {
      throw new BrowserRunError("SUBMISSION_UNCERTAIN", "The send action could not be confirmed. Check the conversation before retrying to avoid sending the prompt twice.");
    }
    status.submitted = true;
    checkCancelled();
    if (mode === "submit") {
      status.outcome = "submitted";
      status.endedAt = new Date().toISOString();
      record("submitted");
      keepOpen = true;
      return { mode, requestPath, attachmentPaths, modelSelectionWarning };
    }
    record("waiting-for-response");
    const responseText = await waitForFinalAssistantResponse(page, {
      assistantMessagesBefore,
      responseStableMs: options.responseStableMs ?? DEFAULT_RESPONSE_STABLE_MS,
      maxWaitMs: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    });
    checkCancelled();
    // Finish interruptible cleanup before committing the response. A cancel
    // received while Chrome is closing must still preserve any prior response.
    await closeContext();
    checkCancelled();
    atomicWrite(responsePath, responseText);
    status.outcome = "completed";
    status.endedAt = new Date().toISOString();
    record("completed");
    return { mode, requestPath, attachmentPaths, responsePath, responseText, modelSelectionWarning };
  } catch (error) {
    operationFailed = true;
    const failure = options.signal?.aborted ? cancelledError() : error;
    status.outcome = "failed";
    status.endedAt = new Date().toISOString();
    status.errorCode = failure instanceof BrowserRunError ? failure.code : "BROWSER_OPERATION_FAILED";
    if (status.errorCode === "ACCESS_CHALLENGE" || status.errorCode === "ACCESS_CHALLENGE_LOOP") status.verificationRequired = true;
    try { record(status.phase); } catch { /* Preserve the operation's original error. */ }
    throw failure;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    try {
      if (context && !keepOpen) {
        try { await closeContext(); }
        catch (error) { if (!operationFailed) throw error; }
      }
    }
    finally { release(); }
  }
}

async function uploadAttachments(
  page: Page,
  attachmentPaths: string[],
  providerUrl: string,
): Promise<void> {
  const attachSelectors = [
    '[data-testid="composer-plus-btn"]',
    'button[aria-label="Add photos and files"]',
    'button[aria-label="Allega file"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Allega"]',
    'button:has-text("Attach")',
    'button:has-text("Allega")',
  ];

  for (const selector of attachSelectors) {
    const button = page.locator(selector).first();
    let fileChooser;
    try {
      if (!await button.isVisible()) continue;
      fileChooser = await openAttachmentFileChooser(page, button);
    } catch {
      continue; // Discover another control only before any file is uploaded.
    }
    assertChatOrigin(page, providerUrl);
    await fileChooser.setFiles(attachmentPaths);
    await waitForUploadedAttachmentNames(page, attachmentPaths);
    return;
  }

  const fileInput = page.locator('input[type="file"]').last();

  try {
    assertChatOrigin(page, providerUrl);
    await fileInput.setInputFiles(attachmentPaths, { timeout: 10_000 });
  } catch (error) {
    if (error instanceof BrowserRunError) throw error;
    throw new BrowserRunError("ATTACHMENT_UNAVAILABLE", "Unable to attach files in ChatGPT. The web UI may have changed or file upload may not be available for this chat. No prompt was sent.");
  }
  await waitForUploadedAttachmentNames(page, attachmentPaths);
}

async function openAttachmentFileChooser(
  page: Page,
  button: ReturnType<Page["locator"]>,
) {
  const directChooser = page
    .waitForEvent("filechooser", { timeout: 1_500 })
    .catch(() => null);
  await button.click();

  const directFileChooser = await directChooser;
  if (directFileChooser) {
    return directFileChooser;
  }

  const uploadMenuSelectors = [
    '[role="menuitem"]:has-text("Upload from computer")',
    '[role="menuitem"]:has-text("Upload files")',
    '[role="menuitem"]:has-text("Add photos and files")',
    '[role="menuitem"]:has-text("Carica dal computer")',
    '[role="menuitem"]:has-text("Carica file")',
    'button:has-text("Upload from computer")',
    'button:has-text("Upload files")',
    'button:has-text("Add photos and files")',
    'button:has-text("Carica dal computer")',
    'button:has-text("Carica file")',
    'text=/Upload from computer|Upload files|Add photos and files|Carica dal computer|Carica file/i',
  ];

  for (const selector of uploadMenuSelectors) {
    const menuItem = page.locator(selector).first();

    try {
      await menuItem.waitFor({ state: "visible", timeout: 1_200 });
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 3_000 }),
        menuItem.click(),
      ]);
      return fileChooser;
    } catch {
      // try next selector
    }
  }

  throw new Error("Unable to open ChatGPT attachment file chooser.");
}

async function waitForUploadedAttachmentNames(
  page: Page,
  attachmentPaths: string[],
): Promise<void> {
  const fileNames = attachmentPaths.map((attachmentPath) =>
    path.basename(attachmentPath),
  );
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const pageText = await page.locator("body").innerText().catch(() => "");

    if (fileNames.every((fileName) => pageText.includes(fileName))) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new BrowserRunError(
    "ATTACHMENT_UNCONFIRMED", `Timed out confirming uploaded files: ${fileNames.join(", ")}. No prompt was sent; files were not uploaded again.`,
  );
}

async function maybeSelectChatGptModel(
  page: Page,
  options: { model: string; modelSelection: ChatGptModelSelection },
): Promise<string | undefined> {
  try {
    await selectChatGptModel(page, options.model);
    return undefined;
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);

    if (options.modelSelection === "require") {
      throw error;
    }

    return [
      `Requested model "${options.model}" could not be selected.`,
      "Continuing with the currently selected ChatGPT model because modelSelection=prefer.",
      message,
    ].join(" ");
  }
}

async function createFreshPage(context: BrowserContext): Promise<Page> {
  return context.pages().find(page => page.url() === "about:blank") ?? context.newPage();
}

function modelSwitcher(page: Page): Locator {
  return page.locator([
    '[data-testid="model-switcher-dropdown-button"]:visible',
    'button[aria-haspopup="menu"]:has-text("ChatGPT"):visible',
    'button[aria-haspopup="menu"]:has-text("GPT"):visible',
  ].join(", ")).first();
}

function exactModelPattern(model: string): RegExp {
  return new RegExp(`^\\s*${model.trim().split(/\s+/).map(escapeRegExp).join("\\s+")}\\s*$`, "i");
}

async function isModelAlreadySelected(page: Page, model: string): Promise<boolean> {
  const label = await modelSwitcher(page).innerText({ timeout: 300 }).catch(() => "");
  return exactModelPattern(model).test(label) || exactModelPattern(`ChatGPT ${model}`).test(label);
}

async function selectChatGptModel(page: Page, model: string): Promise<void> {
  const normalizedModel = model.trim();
  if (!normalizedModel) throw new BrowserRunError("MODEL_UNAVAILABLE", "The requested model label is empty.");
  if (await isModelAlreadySelected(page, normalizedModel)) return;
  const switcher = modelSwitcher(page);
  if (!await switcher.isVisible()) {
    throw new BrowserRunError("MODEL_UNAVAILABLE", `No model selector is available for requested model: ${normalizedModel}. Sign in and check the labels available to this account.`);
  }
  await switcher.click({ timeout: 2_000 });
  const pattern = exactModelPattern(normalizedModel);
  const candidates = [
    page.getByRole("menuitem", { name: pattern }),
    page.getByRole("menuitemradio", { name: pattern }),
    page.getByRole("option", { name: pattern }),
    page.locator('[role="menu"], [role="listbox"]').getByText(pattern),
  ];
  let selected = false;
  const deadline = Date.now() + 2_000;
  while (!selected && Date.now() < deadline) {
    for (const candidate of candidates) {
      for (const option of await candidate.all()) {
        if (!await option.isVisible()) continue;
        await option.click({ timeout: 2_000 });
        selected = true;
        break;
      }
      if (selected) break;
    }
    if (!selected) await page.waitForTimeout(100);
  }
  if (!selected) {
    throw new BrowserRunError("MODEL_UNAVAILABLE", `Requested ChatGPT model not found: ${normalizedModel}. Use the exact model label shown in the selector.`);
  }
  const confirmationDeadline = Date.now() + 2_000;
  while (Date.now() < confirmationDeadline) {
    if (await isModelAlreadySelected(page, normalizedModel)) return;
    await page.waitForTimeout(100);
  }
  throw new BrowserRunError("MODEL_SELECTION_UNCONFIRMED", `The selector did not confirm model: ${normalizedModel}. No prompt was sent.`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fillChatInput(page: Page, text: string): Promise<void> {
  await chatInput(page).fill(text, { timeout: 10_000 });
}

async function waitForSendButton(page: Page): Promise<Locator> {
  const selectors = [
    '[data-testid="composer-submit-button"]:visible',
    '[data-testid="send-button"]:visible',
    'button[aria-label="Send message"]:visible',
    'button[aria-label="Invia messaggio"]:visible',
    'button[aria-label="Send prompt"]:visible',
    'button[aria-label="Invia prompt"]:visible',
    'button:has-text("Send"):visible',
    'button:has-text("Invia"):visible',
  ].join(", ");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const blocker = await pageBlocker(page);
    if (blocker) throw blocker;
    const button = page.locator(selectors).first();
    if (await button.isEnabled({ timeout: 250 }).catch(() => false)) return button;
    await page.waitForTimeout(250);
  }
  throw new BrowserRunError("SEND_UNAVAILABLE", "No enabled send button appeared. Files may still be uploading or the provider interface may have changed. No prompt was sent.");
}

async function countAssistantMessages(page: Page): Promise<number> {
  return (await assistantMessages(page)).count();
}

async function assistantMessages(page: Page): Promise<Locator> {
  // The current web UI uses role/markdown/completion attributes; retain the
  // older renderer without counting nested containers as separate messages.
  const current = page.locator('[data-message-role="assistant"]');
  return (await current.count()) > 0
    ? current
    : page.locator('[data-message-author-role="assistant"]');
}

async function waitForFinalAssistantResponse(
  page: Page,
  options: {
    assistantMessagesBefore: number;
    responseStableMs: number;
    maxWaitMs: number;
  },
): Promise<string> {
  const startedAt = Date.now();
  let lastText = "";
  let lastChangedAt = Date.now();

  while (Date.now() - startedAt < options.maxWaitMs) {
    const blocker = await pageBlocker(page);
    if (blocker) throw blocker;
    const messages = await assistantMessages(page);
    const count = await messages.count();

    if (count > options.assistantMessagesBefore) {
      const latest = messages.nth(count - 1);
      const markdown = latest.locator("[data-assistant-markdown]").first();
      const currentText = (await ((await markdown.count()) > 0
        ? markdown.innerText()
        : latest.innerText())).trim();
      const completionConfirmed =
        (await latest.getAttribute("data-message-role")) !== "assistant" ||
        (await latest.getAttribute("data-message-complete")) !== null;

      if (currentText && currentText !== lastText) {
        lastText = currentText;
        lastChangedAt = Date.now();
      }

      if (
        lastText &&
        completionConfirmed &&
        Date.now() - lastChangedAt >= options.responseStableMs &&
        !(await isGenerationInProgress(page))
      ) {
        return lastText;
      }
    }

    await page.waitForTimeout(1_000);
  }

  if (lastText) {
    throw new BrowserRunError("RESPONSE_INCOMPLETE",
      "Timed out before ChatGPT response completion could be confirmed. The response may be incomplete and was not saved. Retry with a longer --max-wait-ms.",
    );
  }

  throw new BrowserRunError("RESPONSE_TIMEOUT", "Timed out waiting for ChatGPT response. The prompt was sent; check the conversation before retrying.");
}

async function isGenerationInProgress(page: Page): Promise<boolean> {
  const stopSelectors = [
    '[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Interrompi generazione"]',
  ];

  for (const selector of stopSelectors) {
    if (await page.locator(selector).first().isVisible()) {
      return true;
    }
  }

  return false;
}
