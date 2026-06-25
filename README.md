# GiviLoop

GiviLoop is a local external-review loop for IDE coding agents.

It lets your agent package local code context, send it to an external LLM such as ChatGPT, save the answer, and then either analyze the feedback or apply only the fixes that make sense.

The point is simple: make external LLM review a repeatable local workflow instead of a copy/paste ritual.

> Current status: V0 prototype. Built for local personal workflows; not production-grade automation.

## Why GiviLoop?

When working with IDE coding agents, getting an external second opinion often turns into a copy/paste loop:

agent summary -> external LLM review -> pasted feedback -> agent interpretation

GiviLoop moves the mechanical packaging step out of the active agent conversation.

It builds a local review or advisory package from git/files, sends it to an external LLM, saves the response locally, and lets the original agent analyze or act on it later.

The goal is to keep the active agent focused on reasoning, implementation, and decisions, not on narrating local files to another chat.

## Demo

### IDE Agent Flow

<video src="https://github.com/user-attachments/assets/6d294d9f-8ac4-4f4a-bbc7-fb0638b7f297" controls width="100%"></video>

## Who Is This For?

GiviLoop is for developers using IDE coding agents who want a controlled way to get a second opinion from an external LLM before accepting or applying changes.

## What It Does

GiviLoop currently supports four workflows:

- send a tracked-file source archive to ChatGPT web and save the review;
- ask an external LLM about a specific file or code pattern;
- review local git changes only;
- bring the saved external response back to the IDE agent for analysis or action.

External responses are advisory. The IDE agent should evaluate the answer critically before changing code.

## Quick Start

Requirements:

- Node.js 20 or newer
- Google Chrome for web automation
- zip for source-archive creation
- A logged-in web LLM session in the browser profile opened by GiviLoop

Recommended first step: run one `--send chatgpt-web --mode auto` command once, log in manually to ChatGPT in the Playwright/Chrome window that GiviLoop opens, then rerun the command. GiviLoop reuses that local browser profile for later requests.

Install and build:

    npm install
    npm run build

Configure your IDE agent to start the MCP server with:

    npm --prefix /path/to/GiviLoop run mcp

You can also run the server directly while developing:

    npm run mcp

## IDE Prompts

Focused review with selected fixes:

    Ask ChatGPT through GiviLoop to review the refund endpoint pattern in server.js.
    When the answer returns, apply only the fixes that make sense.

Focused review without edits:

    Ask ChatGPT through GiviLoop to review the refund endpoint pattern in server.js.
    When the answer returns, analyze it only and do not modify files.

Repository-level review:

    Use GiviLoop to create a tracked-file source archive for this repository, send it to ChatGPT web in auto mode, then analyze the saved response only.
    Do not modify files.

## Console Usage

### Console Flow Demo

<video src="https://github.com/user-attachments/assets/53948c6a-f53c-491f-9759-bca404b0c92e" controls width="100%"></video>

Show help:

    npm --prefix /path/to/GiviLoop run givi -- help

Recommended repository review:

    GIVILOOP_ALLOWED_REPOSITORIES=/path/to/repo \
    npm --prefix /path/to/GiviLoop run givi -- archive \
      --repo /path/to/repo \
      --goal "Review the current implementation" \
      --send chatgpt-web \
      --mode auto \
      --no-untracked

This creates a small source zip from tracked Git files, embeds the manifest in the prompt, uploads the zip to ChatGPT web, sends the request, and saves the answer.

Ask about one file:

    npm --prefix /path/to/GiviLoop run givi -- ask --repo /path/to/repo --file server.js --question "Review the refund endpoint pattern in server.js. Suggest only minimal safe fixes." --send chatgpt-web --mode auto

Advanced diff-only review:

    npm --prefix /path/to/GiviLoop run givi -- prepare --repo /path/to/repo --goal "Review the current implementation"
    npm --prefix /path/to/GiviLoop run givi -- send --repo /path/to/repo --mode auto

Manual source archive fallback:

    npm --prefix /path/to/GiviLoop run givi -- archive --repo /path/to/repo --goal "Review the current implementation"
    npm --prefix /path/to/GiviLoop run givi -- copy --repo /path/to/repo
    # paste the prompt and attach .giviloop/runs/<run-id>/source-context.zip and source-manifest.json to the provider chat

Prepare a Claude manual-review prompt:

    npm --prefix /path/to/GiviLoop run givi -- prepare --repo /path/to/repo --goal "Review the current implementation" --target-provider claude-chat
    npm --prefix /path/to/GiviLoop run givi -- copy --repo /path/to/repo

Manual fallback:

    npm --prefix /path/to/GiviLoop run givi -- prepare --repo /path/to/repo --goal "Review the current implementation"
    npm --prefix /path/to/GiviLoop run givi -- copy --repo /path/to/repo
    # paste into the provider, copy the answer
    npm --prefix /path/to/GiviLoop run givi -- ingest --repo /path/to/repo

After an auto run, ask your IDE agent:

    Use GiviLoop to read the saved external review for this repository with reviewResponseMode act.
    Apply only the fixes that make sense.

Use reviewResponseMode analyze-only when you want a summary without edits.

## Command Orchestration

GiviLoop commands share one run model under `.giviloop/runs/<run-id>/`.

- `archive` is the recommended repository-level entry point. It creates `source-context.zip`, `source-manifest.json`, `external-review-request.md`, and metadata. With `--send chatgpt-web --mode auto`, it uploads the zip, sends the request, and saves the response in the same run.
- `ask` is the focused advisory path. It creates a question run, optionally includes specific files, sends it when `--send chatgpt-web` is present, and saves the response.
- `prepare` is the advanced diff-only path. It creates a review package from git diff and untracked files, but does not send it by itself.
- `send` sends the latest prepared run to ChatGPT web. If the latest run is a source archive, it automatically attaches `source-context.zip`.
- `copy` and `ingest` are the manual fallback pair. Use them for Claude today, provider UI issues, or cases where you want to paste and review before sending.

Provider targeting is intentionally conservative: automated web sending currently supports `chatgpt-chat` through `chatgpt-web`. Claude prompts are generated for manual review until Claude web automation is implemented.

## Output Files

GiviLoop stores local run data under .giviloop/.

Each run contains:

- metadata.json
- external-review-request.md

Runs sent in `auto` mode also contain external-review-response.md.

Review-package runs also include review-package.md.

Source-archive runs also include source-context.zip and source-manifest.json. With `--send chatgpt-web --mode auto`, GiviLoop attaches the zip to ChatGPT web automatically, includes the manifest inline in the prompt, sends the request, and saves the response.

The latest run id is stored in .giviloop/latest-run-id.

GiviLoop keeps the latest 10 runs and prunes older ones.

Add this to your gitignore:

    .giviloop/

It can contain prompts, repository context, review packages, run metadata, and external responses.

## Providers

Implemented now:

- ChatGPT prompt generation
- Claude prompt generation for manual and MCP flows
- ChatGPT web automation through Playwright

Planned:

- Claude web automation

Web model selection is best-effort because provider UIs change. You can request a model label, and you can require selection to succeed when that matters.

## MCP Tools

Most users should use natural-language IDE prompts, but the MCP tools are:

- givi_help
- givi_prepare_from_git
- givi_prepare_from_agent_context
- givi_send_to_web_llm
- givi_send_to_chatgpt_web
- givi_read_external_review
- givi_ask_web_llm

Source archive creation is currently CLI-first. Use `givi archive --send chatgpt-web --mode auto` for that flow. MCP web-send tools can still send an existing source-archive run because they read the run metadata and attach `source-context.zip` automatically.

The important response modes are:

- analyze-only: summarize and triage without editing files
- act: evaluate the advice, apply only sensible fixes, run checks, and report what was accepted or rejected

## Safety And Legal

GiviLoop is independent and is not affiliated with OpenAI, Anthropic, or any external LLM provider.

GiviLoop can send repository content to an external provider.

Review packages may include git diffs, untracked files, repository metadata, explicit file attachments, source archives, prompts, and optional IDE conversation context.

The prototype has basic omission and redaction rules for common sensitive files and secret-like values, but it is not a real secret scanner.

Source archives use git's exclude rules by default and omit common generated, binary, lockfile, credential, and symlink paths. Archive file contents are not line-by-line redacted, so do not archive repositories that contain secrets in tracked source files.

Use it only with repositories and providers you are comfortable sending to an external LLM.

Use provider web automation only if it is allowed by the provider terms and by the account or workspace policies that apply to you.

Before sending code or context to an external provider, make sure that doing so is allowed by your organization, client agreements, confidentiality obligations, and the provider terms that apply to your account.

Optional hardening: set `GIVILOOP_ALLOWED_REPOSITORIES` to a path-delimited list of repository roots that may be sent through web LLM automation.

You are responsible for deciding what can be shared externally. GiviLoop helps package and transmit content; it does not decide whether that transfer is permitted.

## Development

Build:

    npm run build

Run the MCP server:

    npm run mcp

Send the latest prepared request to ChatGPT web:

    npm --prefix /path/to/GiviLoop run givi -- send --repo /path/to/repo --mode auto

## License

MIT
