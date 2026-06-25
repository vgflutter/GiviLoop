import { chromium, type BrowserContext, type Page } from "playwright";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { assertRepositoryAllowedForExternalTransfer } from "./external-transfer.js";

export type ChatGptWebMode = "prefill" | "submit" | "auto";
export type ChatGptModelSelection = "prefer" | "require";

export type ChatGptWebOptions = {
  repositoryPath: string;
  requestPath?: string;
  responsePath?: string;
  attachmentPaths?: string[];
  mode?: ChatGptWebMode;
  model?: string;
  modelSelection?: ChatGptModelSelection;
  chatGptUrl?: string;
  userDataDir?: string;
  responseStableMs?: number;
  maxWaitMs?: number;
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

  const userDataDir =
    options.userDataDir ??
    path.join(os.homedir(), ".giviloop", "browser-profiles", "chatgpt");

  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(path.dirname(responsePath), { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1400, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await createFreshPage(context);

    await page.goto(options.chatGptUrl ?? DEFAULT_CHATGPT_URL, {
      waitUntil: "domcontentloaded",
    });

    await waitForChatInput(page);

    const modelSelectionWarning = options.model
      ? await maybeSelectChatGptModel(page, {
          model: options.model,
          modelSelection: options.modelSelection ?? "prefer",
        })
      : undefined;

    if (options.model) {
      await waitForChatInput(page);
    }

    if (attachmentPaths.length > 0) {
      await uploadAttachments(page, attachmentPaths);
    }
    await fillChatInput(page, requestText);

    if (mode === "prefill") {
      return {
        mode,
        requestPath,
        attachmentPaths,
        modelSelectionWarning,
      };
    }

    const assistantMessagesBefore = await countAssistantMessages(page);

    await clickSend(page);

    if (mode === "submit") {
      return {
        mode,
        requestPath,
        attachmentPaths,
        modelSelectionWarning,
      };
    }

    const responseText = await waitForFinalAssistantResponse(page, {
      assistantMessagesBefore,
      responseStableMs: options.responseStableMs ?? DEFAULT_RESPONSE_STABLE_MS,
      maxWaitMs: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    });

    writeFileSync(responsePath, responseText, "utf8");

    return {
      mode,
      requestPath,
      attachmentPaths,
      responsePath,
      responseText,
      modelSelectionWarning,
    };
  } finally {
    if (mode === "auto") {
      await context.close();
    }
  }
}

async function uploadAttachments(
  page: Page,
  attachmentPaths: string[],
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

    try {
      await button.waitFor({ state: "visible", timeout: 1_200 });
      const fileChooser = await openAttachmentFileChooser(page, button);
      await fileChooser.setFiles(attachmentPaths);
      await waitForUploadedAttachmentNames(page, attachmentPaths);
      return;
    } catch {
      // try next selector
    }
  }

  const fileInput = page.locator('input[type="file"]').last();

  try {
    await fileInput.setInputFiles(attachmentPaths, { timeout: 10_000 });
    await waitForUploadedAttachmentNames(page, attachmentPaths);
    return;
  } catch {
    // handled below
  }

  throw new Error(
    "Unable to attach files in ChatGPT. The web UI may have changed or file upload may not be available for this chat.",
  );
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

  throw new Error(
    `Timed out waiting for uploaded attachment chips: ${fileNames.join(", ")}`,
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
  return context.newPage();
}

async function waitForChatInput(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");

  const selectors = [
    'div#prompt-textarea[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    "textarea",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      await locator.waitFor({ state: "visible", timeout: 10_000 });
      return;
    } catch {
      // try next selector
    }
  }

  throw new Error(
    "ChatGPT input not found. If this is the first run, login manually in the opened browser and rerun the command.",
  );
}

async function selectChatGptModel(page: Page, model: string): Promise<void> {
  const normalizedModel = model.trim();

  if (!normalizedModel) {
    return;
  }

  if (await isModelAlreadySelected(page, normalizedModel)) {
    return;
  }

  const switcherSelectors = [
    '[data-testid="model-switcher-dropdown-button"]',
    'button[aria-haspopup="menu"]:has-text("GPT")',
    'button[aria-haspopup="menu"]:has-text("ChatGPT")',
    'button:has-text("GPT")',
  ];

  for (const selector of switcherSelectors) {
    const switcher = page.locator(selector).first();

    try {
      await switcher.waitFor({ state: "visible", timeout: 1_200 });
      await switcher.click();
      await clickModelOption(page, normalizedModel);
      return;
    } catch {
      // try next selector
    }
  }

  throw new Error(
    `Unable to open ChatGPT model selector for requested model: ${normalizedModel}`,
  );
}

async function isModelAlreadySelected(
  page: Page,
  model: string,
): Promise<boolean> {
  const modelPattern = new RegExp(escapeRegExp(model), "i");
  const buttons = page.getByRole("button", { name: modelPattern });

  try {
    return (await buttons.count()) > 0 && (await buttons.first().isVisible());
  } catch {
    return false;
  }
}

async function clickModelOption(page: Page, model: string): Promise<void> {
  const modelPattern = new RegExp(escapeRegExp(model), "i");
  const options = [
    page.getByRole("menuitem", { name: modelPattern }).first(),
    page.getByRole("option", { name: modelPattern }).first(),
    page.getByRole("button", { name: modelPattern }).first(),
    page.getByText(modelPattern).first(),
  ];

  for (const option of options) {
    try {
      await option.waitFor({ state: "visible", timeout: 1_200 });
      await option.click();
      return;
    } catch {
      // try next selector
    }
  }

  throw new Error(
    `Requested ChatGPT model not found in selector: ${model}. Check the exact model label shown in ChatGPT.`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fillChatInput(page: Page, text: string): Promise<void> {
  const contentEditableInput = page
    .locator('div#prompt-textarea[contenteditable="true"]')
    .first();

  if (await contentEditableInput.count()) {
    await contentEditableInput.click();
    await clearFocusedInput(page);
    await page.keyboard.insertText(text);
    return;
  }

  const genericContentEditableInput = page
    .locator('div[contenteditable="true"][data-placeholder]')
    .first();

  if (await genericContentEditableInput.count()) {
    await genericContentEditableInput.click();
    await clearFocusedInput(page);
    await page.keyboard.insertText(text);
    return;
  }

  const textarea = page.locator("textarea").first();

  if (await textarea.count()) {
    await textarea.fill(text);
    return;
  }

  throw new Error("Unable to fill ChatGPT input.");
}

async function clearFocusedInput(page: Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press("Backspace");
}

async function clickSend(page: Page): Promise<void> {
  const selectors = [
    '[data-testid="composer-submit-button"]',
    '[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Invia messaggio"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Invia prompt"]',
    'button:has-text("Send")',
    'button:has-text("Invia")',
  ];
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const button = page.locator(selector).first();

      try {
        await button.waitFor({ state: "visible", timeout: 500 });
        const disabled = await button
          .evaluate((element) =>
            element instanceof HTMLButtonElement
              ? element.disabled || element.getAttribute("aria-disabled") === "true"
              : element.getAttribute("aria-disabled") === "true",
          )
          .catch(() => true);

        if (disabled) {
          continue;
        }

        await button.click();
        return;
      } catch {
        // try next selector
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    "Unable to find an enabled ChatGPT send button. If files are still uploading, retry after the upload finishes or use --mode prefill.",
  );
}

async function countAssistantMessages(page: Page): Promise<number> {
  return page.locator('[data-message-author-role="assistant"]').count();
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
    const assistantMessages = page.locator(
      '[data-message-author-role="assistant"]',
    );
    const count = await assistantMessages.count();

    if (count > options.assistantMessagesBefore) {
      const latest = assistantMessages.nth(count - 1);
      const currentText = (await latest.innerText()).trim();

      if (currentText && currentText !== lastText) {
        lastText = currentText;
        lastChangedAt = Date.now();
      }

      if (
        lastText &&
        Date.now() - lastChangedAt >= options.responseStableMs &&
        !(await isGenerationInProgress(page))
      ) {
        return lastText;
      }
    }

    await page.waitForTimeout(1_000);
  }

  if (lastText) {
    return lastText;
  }

  throw new Error("Timed out waiting for ChatGPT response.");
}

async function isGenerationInProgress(page: Page): Promise<boolean> {
  const stopSelectors = [
    '[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Interrompi generazione"]',
  ];

  for (const selector of stopSelectors) {
    const count = await page.locator(selector).count();

    if (count > 0) {
      return true;
    }
  }

  return false;
}
