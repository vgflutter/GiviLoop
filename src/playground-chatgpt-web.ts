#!/usr/bin/env node

import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  sendToChatGptWeb,
  type ChatGptModelSelection,
  type ChatGptWebMode,
} from "./providers/chatgpt-web.js";

type CliOptions = {
  repositoryPath: string;
  mode: ChatGptWebMode;
  model?: string;
  modelSelection?: ChatGptModelSelection;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const repositoryPath = path.resolve(options.repositoryPath);

  const outboxDir = path.join(repositoryPath, ".giviloop", "outbox");
  const inboxDir = path.join(repositoryPath, ".giviloop", "inbox");

  mkdirSync(outboxDir, { recursive: true });
  mkdirSync(inboxDir, { recursive: true });

  const legacyChatGptPromptPath = path.join(outboxDir, "chatgpt-prompt.md");
  const latestRun = readLatestReviewRun(repositoryPath);
  const externalReviewRequestPath =
    latestRun?.requestPath ??
    path.join(outboxDir, "external-review-request.md");
  const externalReviewResponsePath =
    latestRun?.responsePath ??
    path.join(inboxDir, "external-review-response.md");

  ensureExternalReviewRequest({
    legacyChatGptPromptPath,
    externalReviewRequestPath,
  });

  console.log("");
  console.log("GiviLoop ChatGPT Web playground");
  console.log("");
  console.log(`Repository: ${repositoryPath}`);
  console.log(`Mode: ${options.mode}`);
  if (options.model) {
    console.log(`Model: ${options.model}`);
    console.log(`Model selection: ${options.modelSelection ?? "prefer"}`);
  }
  console.log(`Request: ${externalReviewRequestPath}`);
  console.log(`Response: ${externalReviewResponsePath}`);
  console.log("");

  const result = await sendToChatGptWeb({
    repositoryPath,
    requestPath: externalReviewRequestPath,
    responsePath: externalReviewResponsePath,
    mode: options.mode,
    model: options.model,
    modelSelection: options.modelSelection,
  });

  if (result.responseText && latestRun) {
    writeFileSync(
      path.join(inboxDir, "external-review-response.md"),
      result.responseText,
      "utf8",
    );
  }

  console.log("Done.");
  console.log("");

  if (result.mode === "prefill") {
    console.log("Il prompt è stato incollato nella textarea di ChatGPT.");
    console.log("Ora puoi controllarlo e premere invio manualmente.");
    return;
  }

  if (result.mode === "submit") {
    console.log("Il prompt è stato incollato e inviato a ChatGPT.");
    console.log(
      "La risposta non è stata letta automaticamente in modalità submit.",
    );
    return;
  }

  console.log(`Risposta salvata in: ${result.responsePath}`);
}

function ensureExternalReviewRequest(input: {
  legacyChatGptPromptPath: string;
  externalReviewRequestPath: string;
}): void {
  if (!existsSync(input.legacyChatGptPromptPath)) {
    if (existsSync(input.externalReviewRequestPath)) {
      return;
    }

    throw new Error(
      [
        "Missing external review request file.",
        "",
        `Expected: ${input.externalReviewRequestPath}`,
        `Fallback not found: ${input.legacyChatGptPromptPath}`,
        "",
        "Generate it first with givi prepare, givi ask, or a GiviLoop MCP prepare/ask tool.",
      ].join("\n"),
    );
  }

  if (
    existsSync(input.externalReviewRequestPath) &&
    statSync(input.externalReviewRequestPath).mtimeMs >=
      statSync(input.legacyChatGptPromptPath).mtimeMs
  ) {
    return;
  }

  const legacyPrompt = readFileSync(input.legacyChatGptPromptPath, "utf8");
  writeFileSync(input.externalReviewRequestPath, legacyPrompt, "utf8");

  console.log(
    `Created ${input.externalReviewRequestPath} from ${input.legacyChatGptPromptPath}`,
  );
}

function readLatestReviewRun(
  repositoryPath: string,
): { requestPath: string; responsePath: string } | undefined {
  const latestRunIdPath = path.join(repositoryPath, ".giviloop", "latest-run-id");

  if (!existsSync(latestRunIdPath)) {
    return undefined;
  }

  const runId = readFileSync(latestRunIdPath, "utf8").trim();

  if (!runId) {
    return undefined;
  }

  const runDir = path.join(repositoryPath, ".giviloop", "runs", runId);

  if (!existsSync(runDir)) {
    return undefined;
  }

  return {
    requestPath: path.join(runDir, "external-review-request.md"),
    responsePath: path.join(runDir, "external-review-response.md"),
  };
}

function parseArgs(args: string[]): CliOptions {
  const repositoryPath =
    readOption(args, "--repo") ??
    readOption(args, "--repositoryPath") ??
    process.cwd();

  const modeRaw = readOption(args, "--mode") ?? "prefill";
  const model = readOption(args, "--model");
  const modelSelection = args.includes("--require-model")
    ? "require"
    : "prefer";

  if (!["prefill", "submit", "auto"].includes(modeRaw)) {
    throw new Error(`Invalid mode: ${modeRaw}. Use prefill, submit, or auto.`);
  }

  return {
    repositoryPath,
    mode: modeRaw as ChatGptWebMode,
    model,
    modelSelection,
  };
}

function readOption(args: string[], name: string): string | undefined {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));

  if (equalsArg) {
    return equalsArg.slice(name.length + 1);
  }

  const index = args.indexOf(name);

  if (index >= 0) {
    const value = args[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for option: ${name}`);
    }

    return value;
  }

  return undefined;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("");
  console.error(`GiviLoop ChatGPT Web error: ${message}`);
  console.error("");

  process.exit(1);
});
