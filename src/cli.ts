#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  sendToChatGptWeb,
  type ChatGptModelSelection,
  type ChatGptWebMode,
} from "./providers/chatgpt-web.js";

const GIVI_DIR = ".giviloop";
const OUTBOX_DIR = path.join(GIVI_DIR, "outbox");
const INBOX_DIR = path.join(GIVI_DIR, "inbox");
const RUNS_DIR = path.join(GIVI_DIR, "runs");
const LATEST_RUN_ID_PATH = path.join(GIVI_DIR, "latest-run-id");
const REVIEW_PACKAGE_PATH = path.join(OUTBOX_DIR, "review-package.md");
const CHATGPT_PROMPT_PATH = path.join(OUTBOX_DIR, "chatgpt-prompt.md");
const CLAUDE_PROMPT_PATH = path.join(OUTBOX_DIR, "claude-prompt.md");
const EXTERNAL_REVIEW_REQUEST_PATH = path.join(
  OUTBOX_DIR,
  "external-review-request.md",
);
const EXTERNAL_REVIEW_RESPONSE_PATH = path.join(
  INBOX_DIR,
  "external-review-response.md",
);
const DEFAULT_MAX_FILE_SIZE_BYTES = 40_000;
const DEFAULT_MAX_TOTAL_PACKAGE_BYTES = 400_000;
const DEFAULT_MAX_ARCHIVE_FILE_SIZE_BYTES = 250_000;
const DEFAULT_MAX_ARCHIVE_BYTES = 2_000_000;
const MAX_REVIEW_RUNS = 10;
const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/;

type ReviewRun = {
  runId: string;
  runDir: string;
  reviewPackagePath: string;
  requestPath: string;
  responsePath: string;
};

type ContentBudget = {
  remainingBytes: number;
};

type SafeRepositoryFile = {
  absolutePath: string;
  normalizedPath: string;
  size: number;
  skippedReason?: string;
};

type ArchiveIncludedFile = {
  path: string;
  size: number;
};

type ArchiveSkippedFile = {
  path: string;
  reason: string;
  size?: number;
};

type SourceArchiveManifest = {
  runId: string;
  createdAt: string;
  mode: "source-archive";
  targetProvider: TargetProvider;
  goal: string;
  includeUntracked: boolean;
  archive: {
    path: string;
    sha256: string;
    fileCount: number;
    totalBytes: number;
    maxArchiveBytes: number;
    maxFileSizeBytes: number;
  };
  files: {
    included: ArchiveIncludedFile[];
    skipped: ArchiveSkippedFile[];
  };
};

type TargetProvider = "chatgpt-chat" | "claude-chat";
type Command =
  | "prepare"
  | "ask"
  | "archive"
  | "send"
  | "copy"
  | "ingest"
  | "help";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = (args[0] ?? "help") as Command;

  try {
    switch (command) {
      case "prepare":
        prepare(args.slice(1));
        break;
      case "ask":
        await ask(args.slice(1));
        break;
      case "archive":
        await archiveSource(args.slice(1));
        break;
      case "send":
        await sendPrepared(args.slice(1));
        break;
      case "copy":
        copyPrompt(args.slice(1));
        break;
      case "ingest":
        ingestReview(args.slice(1));
        break;
      case "help":
      default:
        printHelp();
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nGiviLoop error: ${message}\n`);
    process.exit(1);
  }
}

async function ask(args: string[]): Promise<void> {
  useRepository(args);

  const question = readOption(args, "--question") ?? readOption(args, "-q");

  if (!question) {
    throw new Error('Missing question. Run: givi ask --question "..."');
  }

  ensureGiviDir();

  const maxFileSizeBytes =
    readPositiveNumberOption(args, "--max-file-size-bytes") ??
    DEFAULT_MAX_FILE_SIZE_BYTES;
  const totalBudget = createContentBudget(
    readPositiveNumberOption(args, "--max-total-package-bytes") ??
      DEFAULT_MAX_TOTAL_PACKAGE_BYTES,
  );
  const targetProvider = readTargetProvider(args);
  const attachedFiles = readAttachedFiles(args, maxFileSizeBytes, totalBudget);
  const prompt = buildAdvisoryQuestionPrompt(question, attachedFiles);
  const reviewRun = createReviewRun();

  writeFileSync(EXTERNAL_REVIEW_REQUEST_PATH, prompt, "utf8");
  writeFileSync(reviewRun.requestPath, prompt, "utf8");
  writeAdvisoryRunMetadata(reviewRun, {
    question,
    attachedFiles: attachedFiles.map((file) => file.path),
    targetProvider,
    requestText: prompt,
  });
  writeFileSync(LATEST_RUN_ID_PATH, `${reviewRun.runId}\n`, "utf8");
  pruneOldReviewRuns(MAX_REVIEW_RUNS);

  console.log(`Created ${reviewRun.runDir}`);
  console.log(`Created ${EXTERNAL_REVIEW_REQUEST_PATH}`);

  const sendProvider = readOption(args, "--send");

  if (!sendProvider) {
    return;
  }

  if (targetProvider !== "chatgpt-chat") {
    throw new Error(
      "Automated web sending is currently implemented only for chatgpt-chat/chatgpt-web. Use manual copy/ingest for claude-chat.",
    );
  }

  if (sendProvider !== "chatgpt-web") {
    throw new Error(`Unsupported send provider: ${sendProvider}`);
  }

  const mode = readWebMode(args);
  const model = readOption(args, "--model");
  const modelSelection = readModelSelection(args);
  const responseStableMs = readPositiveNumberOption(args, "--response-stable-ms");
  const maxWaitMs = readPositiveNumberOption(args, "--max-wait-ms");
  const result = await sendToChatGptWeb({
    repositoryPath: process.cwd(),
    requestPath: reviewRun.requestPath,
    responsePath: reviewRun.responsePath,
    mode,
    model,
    modelSelection,
    responseStableMs,
    maxWaitMs,
  });

  if (result.responseText) {
    writeFileSync(
      EXTERNAL_REVIEW_RESPONSE_PATH,
      result.responseText,
      "utf8",
    );
  }

  if (result.modelSelectionWarning) {
    console.warn(result.modelSelectionWarning);
  }

  console.log(`Sent to ${sendProvider} in ${mode} mode`);

  if (result.responsePath) {
    console.log(`Created ${result.responsePath}`);
  }
}

async function archiveSource(args: string[]): Promise<void> {
  useRepository(args);
  ensureGiviDir();
  ensureGitRepository();

  if (!commandExists("zip")) {
    throw new Error(
      "Missing zip command. Install zip or use givi prepare for prompt-only review packages.",
    );
  }

  const goal = readOption(args, "--goal") ?? "Review the attached source archive.";
  const targetProvider = readTargetProvider(args);
  const includeUntracked = !args.includes("--no-untracked");
  const maxFileSizeBytes =
    readPositiveNumberOption(args, "--max-archive-file-size-bytes") ??
    DEFAULT_MAX_ARCHIVE_FILE_SIZE_BYTES;
  const maxArchiveBytes =
    readPositiveNumberOption(args, "--max-archive-bytes") ??
    DEFAULT_MAX_ARCHIVE_BYTES;

  const reviewRun = createReviewRun();
  const archivePath = path.join(reviewRun.runDir, "source-context.zip");
  const manifestPath = path.join(reviewRun.runDir, "source-manifest.json");
  const { includedFiles, skippedFiles, totalBytes } = collectArchiveFiles({
    includeUntracked,
    maxFileSizeBytes,
    maxArchiveBytes,
  });

  if (includedFiles.length === 0) {
    throw new Error("No source files were eligible for the archive.");
  }

  writeZipArchive(archivePath, includedFiles.map((file) => file.path));

  const archiveSha256 = createHash("sha256")
    .update(readFileSync(archivePath))
    .digest("hex");
  const manifest: SourceArchiveManifest = {
    runId: reviewRun.runId,
    createdAt: new Date().toISOString(),
    mode: "source-archive",
    targetProvider,
    goal,
    includeUntracked,
    archive: {
      path: archivePath,
      sha256: archiveSha256,
      fileCount: includedFiles.length,
      totalBytes,
      maxArchiveBytes,
      maxFileSizeBytes,
    },
    files: {
      included: includedFiles,
      skipped: skippedFiles,
    },
  };
  const prompt = buildSourceArchivePrompt({
    targetProvider,
    goal,
    archivePath,
    manifestPath,
    manifest,
  });

  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(EXTERNAL_REVIEW_REQUEST_PATH, prompt, "utf8");
  writeFileSync(reviewRun.requestPath, prompt, "utf8");
  writeSourceArchiveMetadata(reviewRun, {
    goal,
    targetProvider,
    includeUntracked,
    archivePath,
    manifestPath,
    archiveSha256,
    includedFileCount: includedFiles.length,
    skippedFileCount: skippedFiles.length,
    requestText: prompt,
  });
  writeFileSync(LATEST_RUN_ID_PATH, `${reviewRun.runId}\n`, "utf8");
  pruneOldReviewRuns(MAX_REVIEW_RUNS);

  console.log(`Created ${reviewRun.runDir}`);
  console.log(`Created ${archivePath}`);
  console.log(`Created ${manifestPath}`);
  console.log(`Created ${EXTERNAL_REVIEW_REQUEST_PATH}`);
  console.log(`Included ${includedFiles.length} files (${totalBytes} bytes).`);
  console.log(`Skipped ${skippedFiles.length} files. See ${manifestPath}.`);

  const sendProvider = readOption(args, "--send");

  if (!sendProvider) {
    console.log("Run givi copy, then paste the prompt and attach the zip and manifest to the provider chat.");
    return;
  }

  if (targetProvider !== "chatgpt-chat") {
    throw new Error(
      "Automated archive sending is currently implemented only for chatgpt-chat/chatgpt-web. Use manual copy/ingest for claude-chat.",
    );
  }

  if (sendProvider !== "chatgpt-web") {
    throw new Error(`Unsupported send provider: ${sendProvider}`);
  }

  const mode = readWebMode(args);
  const model = readOption(args, "--model");
  const modelSelection = readModelSelection(args);
  const responseStableMs = readPositiveNumberOption(args, "--response-stable-ms");
  const maxWaitMs = readPositiveNumberOption(args, "--max-wait-ms");
  const result = await sendToChatGptWeb({
    repositoryPath: process.cwd(),
    requestPath: reviewRun.requestPath,
    responsePath: reviewRun.responsePath,
    attachmentPaths: [archivePath],
    mode,
    model,
    modelSelection,
    responseStableMs,
    maxWaitMs,
  });

  if (result.responseText) {
    writeFileSync(
      EXTERNAL_REVIEW_RESPONSE_PATH,
      result.responseText,
      "utf8",
    );
  }

  if (result.modelSelectionWarning) {
    console.warn(result.modelSelectionWarning);
  }

  console.log(`Sent archive to ${sendProvider} in ${mode} mode`);

  if (result.responsePath) {
    console.log(`Created ${result.responsePath}`);
  }
}

function prepare(args: string[]): void {
  useRepository(args);

  const goal = readOption(args, "--goal") ?? "No goal provided.";
  const maxFileSizeBytes =
    readPositiveNumberOption(args, "--max-file-size-bytes") ??
    DEFAULT_MAX_FILE_SIZE_BYTES;
  const totalBudget = createContentBudget(
    readPositiveNumberOption(args, "--max-total-package-bytes") ??
      DEFAULT_MAX_TOTAL_PACKAGE_BYTES,
  );
  const targetProvider = readTargetProvider(args);

  ensureGiviDir();
  ensureGitRepository();

  const hasHead = gitCan(["rev-parse", "--verify", "HEAD"]);
  const diffNameOnly = hasHead
    ? git(["diff", "--name-only", "HEAD", "--"])
    : "";

  const diffStat = hasHead
    ? git(["diff", "--stat", "HEAD", "--"])
    : "Repository has no commits yet. Diff against HEAD is not available.";

  const trackedFiles = diffNameOnly
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const diff = hasHead
    ? buildTrackedDiff(trackedFiles, maxFileSizeBytes, totalBudget)
    : "";

  const untrackedFiles = getUntrackedFiles();
  const untrackedContent = buildUntrackedContent(
    untrackedFiles,
    maxFileSizeBytes,
    totalBudget,
  );

  const changedFilesSection = [
    diffNameOnly.trim(),
    untrackedFiles.length > 0 ? untrackedFiles.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");

  const content = `# GiviLoop External Review Package

## Metadata

- Created at: ${new Date().toISOString()}
- Source: local git workspace
- Generator: GiviLoop V0
- Target provider: ${targetProvider}

## Goal

${goal}

## Reviewer Instructions

You are an external senior software reviewer.

Review this package from a logic, runtime-risk, and maintainability perspective.

Focus especially on:
- hidden defaults
- wrong assumptions
- data consistency
- validation gaps
- runtime errors
- edge cases
- duplicated business logic
- unexpected side effects
- incomplete implementation
- missing tests or weak checks

Do not rewrite the whole implementation unless necessary.

Return your answer using this exact structure:

# External AI Review

## Verdict
safe | risky | blocked

## Critical Issues

## Medium Issues

## Minor Issues

## Questions

## Suggested Fixes

## Reviewer Notes

---

## Changed Files

\`\`\`text
${changedFilesSection || "No changed or untracked files detected."}
\`\`\`

## Diff Stat

\`\`\`text
${diffStat.trim() || "No diff stat available."}
\`\`\`

## Git Diff

\`\`\`diff
${diff.trim() || "No tracked diff available."}
\`\`\`

## Untracked Files Content

${untrackedContent || "No untracked file content included."}
`;

  const prompt = buildProviderPrompt(targetProvider, content);
  const providerPromptPath =
    targetProvider === "claude-chat" ? CLAUDE_PROMPT_PATH : CHATGPT_PROMPT_PATH;
  const reviewRun = createReviewRun();

  writeFileSync(REVIEW_PACKAGE_PATH, content, "utf8");
  writeFileSync(providerPromptPath, prompt, "utf8");
  writeFileSync(EXTERNAL_REVIEW_REQUEST_PATH, prompt, "utf8");
  writeFileSync(reviewRun.reviewPackagePath, content, "utf8");
  writeFileSync(reviewRun.requestPath, prompt, "utf8");
  writeReviewRunMetadata(reviewRun, {
    goal,
    targetProvider,
    requestText: prompt,
  });
  writeFileSync(LATEST_RUN_ID_PATH, `${reviewRun.runId}\n`, "utf8");
  pruneOldReviewRuns(MAX_REVIEW_RUNS);

  console.log(`Created ${reviewRun.runDir}`);
  console.log(`Created ${REVIEW_PACKAGE_PATH}`);
  console.log(`Created ${providerPromptPath}`);
  console.log(`Created ${EXTERNAL_REVIEW_REQUEST_PATH}`);
}

async function sendPrepared(args: string[]): Promise<void> {
  useRepository(args);
  ensureGiviDir();

  const latestRun = readLatestReviewRun();

  if (!latestRun || !existsSync(latestRun.requestPath)) {
    throw new Error(
      "No prepared GiviLoop request found. Run: givi prepare --goal \"...\" or givi archive --goal \"...\" first.",
    );
  }

  const sendProvider = readOption(args, "--send") ?? "chatgpt-web";

  if (sendProvider !== "chatgpt-web") {
    throw new Error(`Unsupported send provider: ${sendProvider}`);
  }

  const metadata = readReviewRunMetadata(latestRun);
  const targetProvider = readMetadataString(metadata, "targetProvider");

  if (targetProvider && targetProvider !== "chatgpt-chat") {
    throw new Error(
      `Latest request targets ${targetProvider}. Automated web sending currently supports chatgpt-chat only. Use givi copy/ingest for this run or create a chatgpt-chat request.`,
    );
  }

  const attachmentPaths = readPreparedRunAttachmentPaths(latestRun, metadata);
  const mode = readWebMode(args);
  const model = readOption(args, "--model");
  const modelSelection = readModelSelection(args);
  const responseStableMs = readPositiveNumberOption(args, "--response-stable-ms");
  const maxWaitMs = readPositiveNumberOption(args, "--max-wait-ms");
  const result = await sendToChatGptWeb({
    repositoryPath: process.cwd(),
    requestPath: latestRun.requestPath,
    responsePath: latestRun.responsePath,
    attachmentPaths,
    mode,
    model,
    modelSelection,
    responseStableMs,
    maxWaitMs,
  });

  if (result.responseText) {
    writeFileSync(
      EXTERNAL_REVIEW_RESPONSE_PATH,
      result.responseText,
      "utf8",
    );
  }

  if (result.modelSelectionWarning) {
    console.warn(result.modelSelectionWarning);
  }

  console.log(`Sent ${latestRun.requestPath} to ${sendProvider} in ${mode} mode`);

  if (attachmentPaths.length > 0) {
    console.log(`Attached ${attachmentPaths.join(", ")}`);
  }

  if (result.responsePath) {
    console.log(`Created ${result.responsePath}`);
  }
}

function copyPrompt(args: string[]): void {
  useRepository(args);

  ensureGiviDir();

  const latestRun = readLatestReviewRun();

  if (latestRun && existsSync(latestRun.requestPath)) {
    const prompt = readFileSync(latestRun.requestPath, "utf8");
    writeFileSync(EXTERNAL_REVIEW_REQUEST_PATH, prompt, "utf8");
    writeClipboard(prompt);

    console.log(`Copied ${latestRun.requestPath} to clipboard.`);
    console.log(`Updated ${EXTERNAL_REVIEW_REQUEST_PATH}`);
    return;
  }

  if (!existsSync(REVIEW_PACKAGE_PATH)) {
    throw new Error(
      `Missing ${REVIEW_PACKAGE_PATH}. Run: givi prepare --goal "..." or givi ask --question "..."`,
    );
  }

  const reviewPackage = readFileSync(REVIEW_PACKAGE_PATH, "utf8");
  const targetProvider = readTargetProvider(args);
  const providerPromptPath =
    targetProvider === "claude-chat" ? CLAUDE_PROMPT_PATH : CHATGPT_PROMPT_PATH;

  const prompt = buildProviderPrompt(targetProvider, reviewPackage);

  writeFileSync(providerPromptPath, prompt, "utf8");
  writeFileSync(EXTERNAL_REVIEW_REQUEST_PATH, prompt, "utf8");
  writeClipboard(prompt);

  console.log(`Created ${providerPromptPath}`);
  console.log(`Created ${EXTERNAL_REVIEW_REQUEST_PATH}`);
  console.log("Copied provider review prompt to clipboard.");
}

function buildProviderPrompt(
  provider: TargetProvider,
  reviewPackage: string,
): string {
  const providerName = provider === "claude-chat" ? "Claude" : "ChatGPT";

  return `You are ${providerName}, acting as an external senior software reviewer.

Review the following implementation package.
Focus on logic, runtime risks, validation gaps, data consistency, edge cases, and maintainability.

Important rules:
- Do not rewrite the full code unless necessary.
- Do not give generic advice.
- Be concrete and actionable.
- If something is safe, say it is safe.
- If something is risky, explain exactly why.
- If the package is insufficient, ask precise questions.

Return the answer using exactly this structure:

# External AI Review

## Verdict
safe | risky | blocked

## Critical Issues
- ...

## Medium Issues
- ...

## Minor Issues
- ...

## Questions
- ...

## Suggested Fixes
- ...

## Reviewer Notes
- ...

Here is the review package:

<REVIEW_PACKAGE>
${reviewPackage}
</REVIEW_PACKAGE>
`;
}

function buildSourceArchivePrompt(input: {
  targetProvider: TargetProvider;
  goal: string;
  archivePath: string;
  manifestPath: string;
  manifest: SourceArchiveManifest;
}): string {
  const providerName =
    input.targetProvider === "claude-chat" ? "Claude" : "ChatGPT";

  return `You are ${providerName}, acting as an external senior software reviewer.

I attached a source archive generated by GiviLoop:

- Source archive: ${input.archivePath}
- Local manifest path: ${input.manifestPath}

Use the inline manifest below to understand which files were included or skipped.

Goal:

${input.goal.trim()}

Archive summary:

- Included files: ${input.manifest.archive.fileCount}
- Included source bytes before zip compression: ${input.manifest.archive.totalBytes}
- Skipped files: ${input.manifest.files.skipped.length}

Manifest JSON:

\`\`\`json
${JSON.stringify(input.manifest, null, 2)}
\`\`\`

Important rules:
- Treat this archive as repository context, not as permission to modify code.
- Focus on logic, runtime risks, validation gaps, data consistency, edge cases, and maintainability.
- Do not give generic advice.
- Be concrete and actionable.
- If more context is needed, say exactly what is missing.

Return the answer using this structure:

# External AI Review

## Verdict
safe | risky | blocked

## Critical Issues

## Medium Issues

## Minor Issues

## Questions

## Suggested Fixes

## Reviewer Notes
`;
}

function collectArchiveFiles(input: {
  includeUntracked: boolean;
  maxFileSizeBytes: number;
  maxArchiveBytes: number;
}): {
  includedFiles: ArchiveIncludedFile[];
  skippedFiles: ArchiveSkippedFile[];
  totalBytes: number;
} {
  const includedFiles: ArchiveIncludedFile[] = [];
  const skippedFiles: ArchiveSkippedFile[] = getIgnoredFiles().map((file) => ({
    path: file,
    reason: "ignored by git exclude rules.",
  }));
  let totalBytes = 0;

  for (const file of getArchiveCandidateFiles(input.includeUntracked)) {
    if (file.includes("\n")) {
      skippedFiles.push({
        path: file,
        reason: "path contains a newline and cannot be archived safely.",
      });
      continue;
    }

    try {
      const safeFile = inspectRepositoryFile(process.cwd(), file);

      if (safeFile.skippedReason) {
        skippedFiles.push({
          path: safeFile.normalizedPath,
          reason: safeFile.skippedReason,
          size: safeFile.size,
        });
        continue;
      }

      if (shouldOmitFileContent(safeFile.normalizedPath)) {
        skippedFiles.push({
          path: safeFile.normalizedPath,
          reason:
            "file omitted because it is sensitive, generated, binary, lockfile, or not useful for review.",
          size: safeFile.size,
        });
        continue;
      }

      if (safeFile.size > input.maxFileSizeBytes) {
        skippedFiles.push({
          path: safeFile.normalizedPath,
          reason: `file too large (${safeFile.size} bytes).`,
          size: safeFile.size,
        });
        continue;
      }

      if (totalBytes + safeFile.size > input.maxArchiveBytes) {
        skippedFiles.push({
          path: safeFile.normalizedPath,
          reason: `archive budget exhausted (${safeFile.size} bytes requested, ${input.maxArchiveBytes - totalBytes} bytes remaining).`,
          size: safeFile.size,
        });
        continue;
      }

      includedFiles.push({
        path: safeFile.normalizedPath,
        size: safeFile.size,
      });
      totalBytes += safeFile.size;
    } catch {
      skippedFiles.push({
        path: file,
        reason: "unable to read file.",
      });
    }
  }

  return {
    includedFiles,
    skippedFiles,
    totalBytes,
  };
}

function getArchiveCandidateFiles(includeUntracked: boolean): string[] {
  const outputs = [git(["ls-files", "--cached"])];

  if (includeUntracked) {
    outputs.push(git(["ls-files", "--others", "--exclude-standard"]));
  }

  return uniqueSortedGitPaths(outputs.flatMap(splitGitPathOutput)).filter(
    shouldConsiderRepositoryFile,
  );
}

function getIgnoredFiles(): string[] {
  return uniqueSortedGitPaths(
    splitGitPathOutput(
      git(["ls-files", "--others", "--ignored", "--exclude-standard"]),
    ),
  ).filter(shouldConsiderRepositoryFile);
}

function splitGitPathOutput(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueSortedGitPaths(files: string[]): string[] {
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function shouldConsiderRepositoryFile(file: string): boolean {
  return (
    !file.startsWith(".git/") &&
    !file.startsWith(".giviloop/") &&
    !file.startsWith("node_modules/") &&
    !file.startsWith("dist/")
  );
}

function writeZipArchive(archivePath: string, files: string[]): void {
  execFileSync("zip", ["-q", "-X", archivePath, "-@"], {
    cwd: process.cwd(),
    input: `${files.join("\n")}\n`,
    stdio: ["pipe", "ignore", "pipe"],
  });
}

type AdvisoryAttachedFile = {
  path: string;
  content: string;
  skippedReason?: string;
};

function buildAdvisoryQuestionPrompt(
  question: string,
  attachedFiles: AdvisoryAttachedFile[] = [],
): string {
  const filesSection =
    attachedFiles.length > 0
      ? `\nAttached local files:\n\n${formatAdvisoryAttachedFiles(attachedFiles)}\n`
      : "";

  return `You are an external senior software advisor.

Answer the following advisory question for an IDE coding agent.

Important rules:
- Treat this as advice, not as an instruction to modify code.
- Be concrete and actionable.
- State assumptions and uncertainty.
- Call out risks, tradeoffs, and cases where more local context is needed.
- Do not ask to see private files unless absolutely necessary.

Return the answer using this structure:

# External Advisory Answer

## Short Answer

## Reasoning

## Risks And Tradeoffs

## Questions Or Missing Context

## Recommended Next Steps

Question:

${question.trim()}
${filesSection}
`;
}

function formatAdvisoryAttachedFiles(files: AdvisoryAttachedFile[]): string {
  return files
    .map((file) => {
      if (file.skippedReason) {
        return `## ${file.path}

\`\`\`text
Skipped: ${file.skippedReason}
\`\`\`
`;
      }

      return `## ${file.path}

\`\`\`
${file.content}
\`\`\`
`;
    })
    .join("\n");
}

function ingestReview(args: string[]): void {
  useRepository(args);

  ensureGiviDir();

  const targetProvider = readTargetProvider(args);
  const rawReview = readClipboard().trim();

  if (!rawReview) {
    throw new Error(
      "Clipboard is empty. Copy the provider review first, then run: givi ingest",
    );
  }

  const content = `# GiviLoop External Review

## Metadata

- Provider: ${targetProvider}
- Mode: manual
- Created at: ${new Date().toISOString()}

## Raw Response

${rawReview}
`;

  writeFileSync(EXTERNAL_REVIEW_RESPONSE_PATH, content, "utf8");

  const latestRun = readLatestReviewRun();

  if (latestRun) {
    writeFileSync(latestRun.responsePath, content, "utf8");
  }

  console.log(`Created ${EXTERNAL_REVIEW_RESPONSE_PATH}`);

  if (latestRun) {
    console.log(`Created ${latestRun.responsePath}`);
  }
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

function readOptions(args: string[], name: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
      continue;
    }

    if (arg === name) {
      const value = args[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for option: ${name}`);
      }

      values.push(value);
      index += 1;
    }
  }

  return values;
}

function readPositiveNumberOption(
  args: string[],
  name: string,
): number | undefined {
  const rawValue = readOption(args, name);

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${name}: use a positive number.`);
  }

  return value;
}

function readWebMode(args: string[]): ChatGptWebMode {
  const mode = readOption(args, "--mode") ?? "auto";

  if (mode === "prefill" || mode === "submit" || mode === "auto") {
    return mode;
  }

  throw new Error(`Invalid mode: ${mode}. Use prefill, submit, or auto.`);
}

function readModelSelection(args: string[]): ChatGptModelSelection {
  return args.includes("--require-model") ? "require" : "prefer";
}

function readTargetProvider(args: string[]): TargetProvider {
  const provider =
    readOption(args, "--target-provider") ?? readOption(args, "--provider");

  if (!provider) {
    return "chatgpt-chat";
  }

  if (provider === "chatgpt-chat" || provider === "claude-chat") {
    return provider;
  }

  throw new Error(
    `Invalid target provider: ${provider}. Use chatgpt-chat or claude-chat.`,
  );
}

function useRepository(args: string[]): void {
  const repositoryPath =
    readOption(args, "--repo") ?? readOption(args, "--repositoryPath");

  if (!repositoryPath) {
    return;
  }

  const resolvedPath = path.resolve(repositoryPath);

  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${resolvedPath}`);
  }

  process.chdir(resolvedPath);
}

function ensureGitRepository(): void {
  if (!gitCan(["rev-parse", "--is-inside-work-tree"])) {
    throw new Error(
      "Current repository path is not a git work tree. Use givi ask --file for non-git examples, or run prepare inside a git repository.",
    );
  }
}

function ensureGiviDir(): void {
  mkdirSync(OUTBOX_DIR, { recursive: true });
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
}

function createReviewRun(): ReviewRun {
  const runId = createRunId();
  const runDir = path.join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  return {
    runId,
    runDir,
    reviewPackagePath: path.join(runDir, "review-package.md"),
    requestPath: path.join(runDir, "external-review-request.md"),
    responsePath: path.join(runDir, "external-review-response.md"),
  };
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = createHash("sha1")
    .update(`${timestamp}:${process.pid}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);

  return `${timestamp}-${suffix}`;
}

function readLatestReviewRun(): ReviewRun | undefined {
  if (!existsSync(LATEST_RUN_ID_PATH)) {
    return undefined;
  }

  const runId = readFileSync(LATEST_RUN_ID_PATH, "utf8").trim();

  if (!runId) {
    return undefined;
  }

  assertValidRunId(runId);

  const runDir = path.join(RUNS_DIR, runId);

  if (!existsSync(runDir)) {
    return undefined;
  }

  return {
    runId,
    runDir,
    reviewPackagePath: path.join(runDir, "review-package.md"),
    requestPath: path.join(runDir, "external-review-request.md"),
    responsePath: path.join(runDir, "external-review-response.md"),
  };
}

function readReviewRunMetadata(
  run: ReviewRun,
): Record<string, unknown> | undefined {
  const metadataPath = path.join(run.runDir, "metadata.json");

  if (!existsSync(metadataPath)) {
    return undefined;
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as unknown;

  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return undefined;
  }

  return metadata as Record<string, unknown>;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];

  return typeof value === "string" ? value : undefined;
}

function readPreparedRunAttachmentPaths(
  run: ReviewRun,
  metadata: Record<string, unknown> | undefined,
): string[] {
  const sourceArchivePath = path.join(run.runDir, "source-context.zip");
  const runMode = readMetadataString(metadata, "mode");

  if (runMode === "source-archive") {
    if (!existsSync(sourceArchivePath)) {
      throw new Error(
        `Latest run is a source archive, but the zip is missing: ${sourceArchivePath}`,
      );
    }

    return [sourceArchivePath];
  }

  if (!runMode && existsSync(sourceArchivePath)) {
    return [sourceArchivePath];
  }

  return [];
}

function writeReviewRunMetadata(
  run: ReviewRun,
  input: { goal: string; targetProvider: TargetProvider; requestText: string },
): void {
  const metadata = {
    runId: run.runId,
    createdAt: new Date().toISOString(),
    mode: "git-only",
    targetProvider: input.targetProvider,
    goal: input.goal,
    files: {
      reviewPackagePath: run.reviewPackagePath,
      requestPath: run.requestPath,
      responsePath: run.responsePath,
    },
    requestSha256: createHash("sha256").update(input.requestText).digest("hex"),
  };

  writeFileSync(
    path.join(run.runDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

function writeAdvisoryRunMetadata(
  run: ReviewRun,
  input: {
    question: string;
    attachedFiles: string[];
    targetProvider: TargetProvider;
    requestText: string;
  },
): void {
  const metadata = {
    runId: run.runId,
    createdAt: new Date().toISOString(),
    mode: "advisory-question",
    targetProvider: input.targetProvider,
    question: input.question,
    attachedFiles: input.attachedFiles,
    files: {
      requestPath: run.requestPath,
      responsePath: run.responsePath,
    },
    requestSha256: createHash("sha256").update(input.requestText).digest("hex"),
  };

  writeFileSync(
    path.join(run.runDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

function writeSourceArchiveMetadata(
  run: ReviewRun,
  input: {
    goal: string;
    targetProvider: TargetProvider;
    includeUntracked: boolean;
    archivePath: string;
    manifestPath: string;
    archiveSha256: string;
    includedFileCount: number;
    skippedFileCount: number;
    requestText: string;
  },
): void {
  const metadata = {
    runId: run.runId,
    createdAt: new Date().toISOString(),
    mode: "source-archive",
    targetProvider: input.targetProvider,
    goal: input.goal,
    includeUntracked: input.includeUntracked,
    archive: {
      path: input.archivePath,
      sha256: input.archiveSha256,
      includedFileCount: input.includedFileCount,
      skippedFileCount: input.skippedFileCount,
    },
    files: {
      requestPath: run.requestPath,
      responsePath: run.responsePath,
      manifestPath: input.manifestPath,
      archivePath: input.archivePath,
    },
    requestSha256: createHash("sha256").update(input.requestText).digest("hex"),
  };

  writeFileSync(
    path.join(run.runDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

function pruneOldReviewRuns(maxRuns: number): void {
  if (!existsSync(RUNS_DIR)) {
    return;
  }

  const runs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const runId of runs.slice(maxRuns)) {
    rmSync(path.join(RUNS_DIR, runId), { recursive: true, force: true });
  }
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitCan(args: string[]): boolean {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function buildTrackedDiff(
  files: string[],
  maxFileSizeBytes: number,
  totalBudget: ContentBudget,
): string {
  return files
    .map((file) => {
      if (shouldOmitFileContent(file)) {
        return `diff -- ${file}

Skipped: tracked diff omitted because the path looks sensitive, generated, binary, lockfile, or not useful for review.
`;
      }

      const fileDiff = git(["diff", "--no-ext-diff", "HEAD", "--", file]);
      const byteLength = Buffer.byteLength(fileDiff, "utf8");

      if (byteLength > maxFileSizeBytes) {
        return `diff -- ${file}

Skipped: tracked diff too large (${byteLength} bytes).
`;
      }

      const budgetReason = tryConsumeBudget(totalBudget, byteLength);

      if (budgetReason) {
        return `diff -- ${file}

Skipped: ${budgetReason}
`;
      }

      return redactSecrets(fileDiff);
    })
    .filter(Boolean)
    .join("\n");
}

function getUntrackedFiles(): string[] {
  const output = git(["ls-files", "--others", "--exclude-standard"]);

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith(".giviloop/"))
    .filter((file) => !file.startsWith("node_modules/"))
    .filter((file) => !file.startsWith("dist/"));
}

function buildUntrackedContent(
  files: string[],
  maxFileSizeBytes: number,
  totalBudget: ContentBudget,
): string {
  return files
    .map((file) => {
      try {
        const safeFile = inspectRepositoryFile(process.cwd(), file);

        if (safeFile.skippedReason) {
          return `### ${safeFile.normalizedPath}

\`\`\`text
Skipped: ${safeFile.skippedReason}
\`\`\`
`;
        }

        if (safeFile.size > maxFileSizeBytes) {
          return `### ${safeFile.normalizedPath}

\`\`\`text
Skipped: file too large (${safeFile.size} bytes).
\`\`\`
`;
        }

        if (shouldOmitFileContent(safeFile.normalizedPath)) {
          return `### ${safeFile.normalizedPath}

\`\`\`text
Skipped: file content omitted because it is sensitive, generated, binary, lockfile, or not useful for review.
\`\`\`
`;
        }

        const budgetReason = tryConsumeBudget(totalBudget, safeFile.size);

        if (budgetReason) {
          return `### ${safeFile.normalizedPath}

\`\`\`text
Skipped: ${budgetReason}
\`\`\`
`;
        }

        const content = redactSecrets(readFileSync(safeFile.absolutePath, "utf8"));

        return `### ${safeFile.normalizedPath}

\`\`\`
${content}
\`\`\`
`;
      } catch {
        return `### ${file}

\`\`\`text
Skipped: unable to read file.
\`\`\`
`;
      }
    })
    .filter(Boolean)
    .join("\n");
}

function readAttachedFiles(
  args: string[],
  maxFileSizeBytes: number,
  totalBudget: ContentBudget,
): AdvisoryAttachedFile[] {
  const requestedFiles = [
    ...readOptions(args, "--file"),
    ...readOptions(args, "-f"),
  ];

  return requestedFiles.map((requestedFile) => {
    const resolvedPath = path.resolve(requestedFile);
    const relativePath = path.relative(process.cwd(), resolvedPath);

    if (
      relativePath === "" ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(
        `Attached file must be inside the repository: ${requestedFile}`,
      );
    }

    const normalizedPath = relativePath.split(path.sep).join("/");

    try {
      const safeFile = inspectRepositoryFile(process.cwd(), requestedFile);

      if (safeFile.skippedReason) {
        return {
          path: safeFile.normalizedPath,
          content: "",
          skippedReason: safeFile.skippedReason,
        };
      }

      if (safeFile.size > maxFileSizeBytes) {
        return {
          path: safeFile.normalizedPath,
          content: "",
          skippedReason: `file too large (${safeFile.size} bytes).`,
        };
      }

      if (shouldOmitFileContent(safeFile.normalizedPath)) {
        return {
          path: safeFile.normalizedPath,
          content: "",
          skippedReason:
            "file content omitted because it is sensitive, generated, binary, lockfile, or not useful for review.",
        };
      }

      const budgetReason = tryConsumeBudget(totalBudget, safeFile.size);

      if (budgetReason) {
        return {
          path: safeFile.normalizedPath,
          content: "",
          skippedReason: budgetReason,
        };
      }

      return {
        path: safeFile.normalizedPath,
        content: redactSecrets(readFileSync(safeFile.absolutePath, "utf8")),
      };
    } catch {
      return {
        path: normalizedPath,
        content: "",
        skippedReason: "unable to read file.",
      };
    }
  });
}

function createContentBudget(maxBytes: number): ContentBudget {
  return {
    remainingBytes: maxBytes,
  };
}

function tryConsumeBudget(
  budget: ContentBudget,
  byteLength: number,
): string | undefined {
  if (byteLength <= budget.remainingBytes) {
    budget.remainingBytes -= byteLength;
    return undefined;
  }

  return `package content budget exhausted (${byteLength} bytes requested, ${budget.remainingBytes} bytes remaining).`;
}

function inspectRepositoryFile(
  repositoryPath: string,
  requestedFile: string,
): SafeRepositoryFile {
  const absolutePath = path.resolve(repositoryPath, requestedFile);
  const relativePath = path.relative(repositoryPath, absolutePath);

  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`File must be inside the repository: ${requestedFile}`);
  }

  const normalizedPath = relativePath.split(path.sep).join("/");
  const stats = lstatSync(absolutePath);

  if (stats.isSymbolicLink()) {
    return {
      absolutePath,
      normalizedPath,
      size: stats.size,
      skippedReason:
        "path is a symbolic link; content omitted to keep review packages inside the repository.",
    };
  }

  if (!stats.isFile()) {
    return {
      absolutePath,
      normalizedPath,
      size: stats.size,
      skippedReason: "path is not a file.",
    };
  }

  const repositoryRealPath = realpathSync(repositoryPath);
  const fileRealPath = realpathSync(absolutePath);

  if (!isPathInside(repositoryRealPath, fileRealPath)) {
    return {
      absolutePath,
      normalizedPath,
      size: stats.size,
      skippedReason:
        "resolved path is outside the repository; content omitted.",
    };
  }

  return {
    absolutePath,
    normalizedPath,
    size: stats.size,
  };
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function assertValidRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid GiviLoop run id: ${runId}`);
  }
}

function shouldOmitFileContent(file: string): boolean {
  const baseName = path.basename(file);
  const extension = path.extname(file).toLowerCase();

  if (
    baseName.startsWith(".env") ||
    [".npmrc", ".pypirc", "id_rsa", "id_ed25519"].includes(baseName) ||
    ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"].includes(
      baseName,
    )
  ) {
    return true;
  }

  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".pem",
    ".key",
    ".crt",
    ".cer",
    ".p12",
    ".pfx",
  ].includes(extension);
}

function redactSecrets(value: string): string {
  return value
    .replace(
      /(["']?(?:api[_-]?key|token|secret|password|passwd|pwd)["']?\s*[:=]\s*)["']?[^"',\s}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(["']?(?:DATABASE_URL|REDIS_URL|POSTGRES_URL|MYSQL_URL)["']?\s*[:=]\s*)["']?[^"',\s}]+/g,
      "$1[REDACTED]",
    )
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY_ID]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "gh[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "github_pat_[REDACTED]")
    .replace(/\bnpm_[A-Za-z0-9]{36,}\b/g, "npm_[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "sk-[REDACTED]")
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    );
}

function writeClipboard(value: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    execFileSync("pbcopy", {
      input: value,
      stdio: ["pipe", "ignore", "pipe"],
    });
    return;
  }

  if (platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "Set-Clipboard"],
      {
        input: value,
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    return;
  }

  if (commandExists("wl-copy")) {
    execFileSync("wl-copy", {
      input: value,
      stdio: ["pipe", "ignore", "pipe"],
    });
    return;
  }

  if (commandExists("xclip")) {
    execFileSync("xclip", ["-selection", "clipboard"], {
      input: value,
      stdio: ["pipe", "ignore", "pipe"],
    });
    return;
  }

  throw new Error(
    "No clipboard tool found. Install wl-copy/xclip or use macOS/Windows clipboard.",
  );
}

function readClipboard(): string {
  const platform = process.platform;

  if (platform === "darwin") {
    return execFileSync("pbpaste", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (platform === "win32") {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-Clipboard -Raw"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

  if (commandExists("wl-paste")) {
    return execFileSync("wl-paste", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (commandExists("xclip")) {
    return execFileSync("xclip", ["-selection", "clipboard", "-o"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  throw new Error(
    "No clipboard tool found. Install wl-paste/xclip or use macOS/Windows clipboard.",
  );
}

function commandExists(command: string): boolean {
  try {
    execFileSync("which", [command], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function printHelp(): void {
  console.log(`
GiviLoop V0

Local external-review loop for IDE coding agents.

Core flows:
  1. Recommended repository review: create a tracked-file source archive, send it, save the answer
     givi archive --repo /path/to/repo --goal "Review the current implementation" --send chatgpt-web --mode auto --no-untracked

  2. Ask about specific code
     givi ask --repo /path/to/repo --file server.js --question "Review this endpoint pattern" --send chatgpt-web --mode auto

  3. Advanced diff-only review
     givi prepare --repo /path/to/repo --goal "Review the current implementation"
     givi send --repo /path/to/repo --send chatgpt-web --mode auto

  4. Manual fallback
     givi prepare --repo /path/to/repo --goal "Review the current implementation"
     givi copy --repo /path/to/repo
     # paste into the provider, copy the answer
     givi ingest --repo /path/to/repo

Commands:
  prepare   Create a review package from local git diff and untracked files.
  ask       Create an advisory request, optionally attaching local files with --file.
  archive   Create a source-context zip and manifest, optionally sending them to ChatGPT web.
  send      Send the latest prepared request to ChatGPT web.
  copy      Copy the latest prepared provider prompt to the clipboard.
  ingest    Save a provider response from the clipboard into the latest run and inbox.
  help      Show this help.

Important options:
  --repo PATH               Repository to review or store the GiviLoop run in.
  --question TEXT           Advisory question for givi ask.
  --goal TEXT               Goal/context for givi prepare.
  --file PATH               Attach a repository-local file to givi ask. Can be repeated.
  --target-provider chatgpt-chat|claude-chat
                            Generate provider-specific manual prompts. Defaults to chatgpt-chat.
  --send chatgpt-web        Send the generated request to ChatGPT web.
  --mode prefill|submit|auto
                            prefill only fills the prompt; submit sends it; auto waits and saves the answer.
  --model LABEL             Request a provider-specific web UI model label.
  --require-model           Fail if the requested web UI model cannot be selected.
  --max-wait-ms N           Maximum wait for an auto-mode provider response.
  --response-stable-ms N    Required response stability window before saving.
  --max-file-size-bytes N   Skip attached/untracked/tracked content larger than N bytes.
  --max-total-package-bytes N
                            Skip additional included content after the package budget is exhausted.
  --max-archive-file-size-bytes N
                            Skip archive files larger than N bytes. Defaults to 250000 bytes.
  --max-archive-bytes N     Stop adding archive files after this source-byte budget. Defaults to 2000000 bytes.
  --no-untracked            For givi archive, include tracked files only. Recommended for customer runs.

After an auto run, ask your IDE agent:
  Use GiviLoop to read the saved external review for this repository with reviewResponseMode act.
  Apply only the fixes that make sense.
`);
}

main();
