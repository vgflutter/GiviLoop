# GiviLoop

GiviLoop is a local external-review loop for IDE coding agents.

It lets your agent package local code context, send it to an external LLM such as ChatGPT, save the answer, and then either analyze the feedback or apply only the fixes that make sense.

The point is simple: make external LLM review a repeatable local workflow instead of a copy/paste ritual.

> Current status: V0 prototype. Built for local personal workflows; not production-grade automation.

## Demo

### IDE Agent Flow

<video src="https://github.com/user-attachments/assets/6d294d9f-8ac4-4f4a-bbc7-fb0638b7f297" controls width="100%"></video>

[Watch the IDE agent flow demo](https://github.com/user-attachments/assets/6d294d9f-8ac4-4f4a-bbc7-fb0638b7f297)

## Who Is This For?

GiviLoop is for developers using IDE coding agents who want a controlled way to get a second opinion from an external LLM before accepting or applying changes.

## What It Does

GiviLoop currently supports three main workflows:

- review local git changes;
- ask an external LLM about a specific file or code pattern;
- bring the saved external response back to the IDE agent for analysis or action.

External responses are advisory. The IDE agent should evaluate the answer critically before changing code.

## Quick Start

Requirements:

- Node.js 20 or newer
- Google Chrome for web automation
- A logged-in web LLM session in the browser profile opened by GiviLoop

Recommended first step: run the web bridge once, log in manually to the target LLM provider in the Playwright/Chrome window that GiviLoop opens, then rerun the command. GiviLoop reuses that local browser profile for later requests.

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

    Use GiviLoop to prepare a git-only external review for this repository, send it to chatgpt-web in auto mode, then analyze the response only.
    Do not modify files.

## Console Usage

### Console Flow Demo

<video src="https://github.com/user-attachments/assets/53948c6a-f53c-491f-9759-bca404b0c92e" controls width="100%"></video>

[Watch the console flow demo](https://github.com/user-attachments/assets/53948c6a-f53c-491f-9759-bca404b0c92e)

Show help:

    npm --prefix /path/to/GiviLoop run givi -- help

Ask about one file and send it to ChatGPT web:

    npm --prefix /path/to/GiviLoop run givi -- ask --repo /path/to/repo --file server.js --question "Review the refund endpoint pattern in server.js. Suggest only minimal safe fixes." --send chatgpt-web --mode auto

Prepare a git review package:

    npm --prefix /path/to/GiviLoop run givi -- prepare --repo /path/to/repo --goal "Review the current implementation"

Send the latest prepared request:

    npm --prefix /path/to/GiviLoop run chatgpt:web -- --repo /path/to/repo --mode auto

Manual fallback:

    npm --prefix /path/to/GiviLoop run givi -- prepare --repo /path/to/repo --goal "Review the current implementation"
    npm --prefix /path/to/GiviLoop run givi -- copy --repo /path/to/repo
    # paste into the provider, copy the answer
    npm --prefix /path/to/GiviLoop run givi -- ingest --repo /path/to/repo

After an auto run, ask your IDE agent:

    Use GiviLoop to read the saved external review for this repository with reviewResponseMode act.
    Apply only the fixes that make sense.

Use reviewResponseMode analyze-only when you want a summary without edits.

## Output Files

GiviLoop stores local run data under .giviloop/.

Each run contains:

- metadata.json
- external-review-request.md
- external-review-response.md

Review-package runs also include review-package.md.

The latest run id is stored in .giviloop/latest-run-id.

GiviLoop keeps the latest 10 runs and prunes older ones.

Add this to your gitignore:

    .giviloop/

It can contain prompts, repository context, review packages, run metadata, and external responses.

## Providers

Implemented now:

- ChatGPT prompt generation
- ChatGPT web automation through Playwright

Planned:

- Claude prompt generation
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

The important response modes are:

- analyze-only: summarize and triage without editing files
- act: evaluate the advice, apply only sensible fixes, run checks, and report what was accepted or rejected

## Safety And Legal

GiviLoop is independent and is not affiliated with OpenAI, Anthropic, or any external LLM provider.

GiviLoop can send repository content to an external provider.

Review packages may include git diffs, untracked files, repository metadata, explicit file attachments, prompts, and optional IDE conversation context.

The prototype has basic omission and redaction rules for common sensitive files and secret-like values, but it is not a real secret scanner.

Use it only with repositories and providers you are comfortable sending to an external LLM.

Use provider web automation only if it is allowed by the provider terms and by the account or workspace policies that apply to you.

Before sending code or context to an external provider, make sure that doing so is allowed by your organization, client agreements, confidentiality obligations, and the provider terms that apply to your account.

You are responsible for deciding what can be shared externally. GiviLoop helps package and transmit content; it does not decide whether that transfer is permitted.

## Development

Build:

    npm run build

Run the MCP server:

    npm run mcp

Run the ChatGPT web bridge:

    npm --prefix /path/to/GiviLoop run chatgpt:web -- --repo /path/to/repo --mode auto

## License

MIT
