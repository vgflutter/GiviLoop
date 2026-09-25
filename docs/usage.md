# GiviLoop usage reference

[Back to the README](../README.md) · [Double Check workflow](double-check.md)

Detailed CLI/MCP examples, browser options, provider behavior and data handling. For the shortest path to a first review, start with the README.

## Everyday commands (current source checkout)

Configure your reviewer once in the project, then reuse it:

```sh
npm run givi -- setup --provider chatgpt-web --non-interactive
npm run givi -- review
npm run givi -- opinion "What alternatives and tradeoffs do you see?" -f proposal.md
npm run givi -- answer
```

`review` sends current Git changes; `review -f path` sends selected code instead.
`opinion "question"` sends only the question and optional repeated `-f` files.
Both use saved provider/model/profile settings and default to background web
delivery. `--send NAME` overrides the provider for one request. Manual-provider
preferences require the existing prepare/copy/ingest workflow or an explicit
provider override. No code changes are applied by these commands.

`answer` prints the latest completed response without opening Chrome or sending
again. Use `answer --run-id ID` for an older run. Missing, failed, active or changed
requests are refused, even if an old response file remains; `status` explains the
current state. A manually ingested answer is readable too.

`opinion` also accepts `--question`/`-q`; pass exactly one question and quote it.
It preserves `ask`'s prepare-only behavior: `ask --question "..."` does not send
unless `--send` is explicit. `help` shows the short command list; `help --all`
shows the complete reference. After building, `npm link` exposes the current
checkout as `givi` to avoid the `npm run givi --` prefix.

## Installation and requirements

From a checkout, run `npm ci` and `npm run build`. Examples below use `npm run givi --`; after a global installation, use `givi` instead.

To install a locally built archive:

```sh
npm install -g /path/to/giviloop-0.8.0.tgz
```

The package exposes `givi` and `givi-mcp`. Node.js 20+ is required; use Git for diff/archive flows, `zip` for archives, and a separately installed runtime with compatible weights for local inference. Clipboard flows use macOS/Windows system utilities, or `wl-clipboard`/`xclip` on Linux. Google Chrome is only needed for web automation.

GiviLoop uses the dedicated profile `~/.giviloop/browser-profiles/chatgpt`. Start with `givi browser check`, which tests access without submitting a prompt. A usable anonymous composer is sufficient; the presence of a login button does not by itself require sign-in. If the website requires authentication, run `givi browser login`, sign in, then quit that Chrome before automation opens the profile. GiviLoop does not create accounts or bypass login requirements.

To test without changing an existing login, pass a new dedicated path to both commands:

```sh
npm run givi -- browser check --browser-profile "$HOME/.giviloop/browser-profiles/chatgpt-anonymous"
npm run givi -- ask --repo . --file examples/double-check/sum.ts \
  --question "Find a concrete bug and its smallest fix." \
  --send chatgpt-web --mode auto --background \
  --browser-profile "$HOME/.giviloop/browser-profiles/chatgpt-anonymous"
```

That profile remains anonymous only while nobody signs into it. Availability, quotas and features depend on the website; Claude supports automated text reviews with a signed-in account; anonymous access redirected to login in live checks. See [provider results and limitations](web-providers.md).

## Optional automatic task-end review

`givi auto-review enable --repo /path/to/project` installs an AGENTS.md rule and pins the saved reviewer for that local checkout. Add `--client codex` to install project-local MCP settings and scoped workflow-tool approvals for Codex; otherwise connect MCP in your client. Start a new session in the trusted project. The host calls `givi_auto_review` once at task completion with selected changed files, a stable task ID and the outcome of its checks. The host still verifies findings; delivery alone is not a pass. Use `auto-review status` / `disable` to inspect or revoke it. [Scope, guards and recovery](automatic-review.md).

## Local Inference

Start your local runtime and use `givi models --provider NAME` to discover the exact model name. Supported provider names are `ollama`, `dwarfstar`, `llama-cpp`, `lmstudio`, and `mlx`. The same commands with `doctor` verify availability. GiviLoop never downloads weights or switches to a cloud provider automatically.

    npm run givi -- ask --repo /path/to/repo --file src/cart.ts \
      --question "Find a concrete correctness bug and propose regression tests" \
      --send ollama --model MODEL_FROM_DISCOVERY \
      --max-output-tokens 8192 --max-wait-ms 300000

For a prepared diff:

    npm run givi -- prepare --repo /path/to/repo --goal "Review the current changes"
    npm run givi -- send --repo /path/to/repo --send ollama --model MODEL_FROM_DISCOVERY

Use `--send dwarfstar` for a running `ds4-server`, with the **actual loaded model name** from discovery. DwarfStar's compatibility aliases do not change the loaded weights. Local adapters accept text context, not ZIP uploads.

MCP provides `givi_local_models`, `givi_ask_local_llm`, and `givi_send_to_local_llm`. Pass a supported `provider` name and an explicit `model`. The ask tool also accepts `question` and `attachedFiles`; the send tool accepts `runId`. Both support `baseUrl`, `maxWaitMs`, `maxOutputTokens`, `contextTokens`, `reasoning`, and `reviewResponseMode`.

`--reasoning off|on|low|medium|high` is model/runtime dependent. Thinking may consume the output budget; a truncated answer is rejected. GiviLoop saves the final answer, not a separate thinking trace. `local-usage.json` records the runtime's actual counts, model and duration, with request/response hashes; missing metrics remain unknown. Model-owned sampling defaults are preserved.

Only loopback endpoints are accepted (`--base-url` / MCP `baseUrl`). The HTTP client uses direct local connections, refuses redirects, and does not use environment proxies. Ollama models advertising a cloud backend are rejected before source text is sent. The local runtime itself must be trusted and configured for local execution. Returning a review to a cloud coding agent still shares that response with the agent provider.

See [llama.cpp, LM Studio and MLX setup](local-engines.md), [Ollama setup and limits](local-engines.md#ollama), [DwarfStar setup and hardware requirements](local-engines.md#dwarfstar).

For browser access, `givi browser check --provider NAME-web` inspects the dedicated profile without sending a prompt. Explicitly visible reviews wait for human verification and continue the same request; quiet mode returns an attention state without showing the window. `--verification-wait-ms` controls the wait. Repeated challenges stop explicitly, and the website can require verification again even with saved cookies. See [browser verification](troubleshooting.md#human-verification-and-repeated-challenges).

## IDE Prompts

Start with a local review:

    Use GiviLoop to list the available Ollama models. With MODEL_FROM_DISCOVERY,
    review src/cart.ts for concrete correctness bugs and suggest regression tests.
    Read the saved response, assess its findings, and do not modify files.

The following web examples require working provider access:

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

Shows the CLI flow: package local context from the terminal, send or copy the request, save the response, and make it available to the IDE agent later.

Show help:

    npm --prefix /path/to/GiviLoop run givi -- help

Optional ChatGPT source-archive review:

    GIVILOOP_ALLOWED_REPOSITORIES=/path/to/repo \
    npm --prefix /path/to/GiviLoop run givi -- archive \
      --repo /path/to/repo \
      --goal "Review the current implementation" \
      --send chatgpt-web \
      --mode auto --foreground \
      --no-untracked

This creates a small source zip from tracked Git files, embeds the manifest in the prompt, uploads the zip to ChatGPT web, sends the request, and saves the answer.

Ask about one file:

    npm --prefix /path/to/GiviLoop run givi -- ask --repo /path/to/repo --file server.js --question "Review the refund endpoint pattern in server.js. Suggest only minimal safe fixes." --send chatgpt-web --mode auto

Double Check of current Git changes:

    npm --prefix /path/to/GiviLoop run givi -- prepare --repo /path/to/repo --goal "Review the current implementation"
    npm --prefix /path/to/GiviLoop run givi -- send --repo /path/to/repo --mode auto

### Run Automatically in the Background

Auto reviews use standard Chrome with a hidden review page by default. `--background` also overrides a saved foreground preference:

    npm run givi -- ask --repo /path/to/repo --file server.js \
      --question "Review this code and suggest minimal fixes" \
      --send chatgpt-web --mode auto --background

For an existing request:

    npm run givi -- send --repo /path/to/repo --mode auto --background

Visible sessions use native Chrome with a temporary loopback DevTools connection and the existing dedicated profile. One-shot CLI runs wait for the owned browser process to exit on completion or cancellation; MCP can retain an idle healthy browser. See [provider results and limitations](web-providers.md).

When provider access is available, auto mode fills the prompt, sends once, waits for a completed answer and saves it. No clipboard interaction is required. Chrome starts without a startup window, loads GiviLoop's bundled offscreen extension in the dedicated profile and creates a hidden top-level review page. Quiet mode pauses for login, cookie choices, human verification and ZIP uploads. Use `givi status`, `givi open`, quit Chrome after setup, then `givi resume`. ZIP uploads require explicit `--foreground`. `WINDOWLESS_UNAVAILABLE` stops without opening a visible fallback. The implementation is validated on macOS; Windows/Linux VM checks are pending. [Requirements and evidence](windowless-browser.md).

CLI closes Chrome on completion. MCP retains healthy quiet sessions for up to 60 seconds idle, at most two dedicated profiles, and starts each review in a fresh conversation. It closes failed/cancelled sessions and closes retained sessions on disconnect. `givi_release_browser_sessions` closes idle sessions before manual login. Concurrent use of the same profile is refused.

For MCP, pass `background: true` and `mode: "auto"` to `givi_send_to_web_llm`, `givi_send_to_chatgpt_web`, or `givi_ask_web_llm`. For example:

    Use GiviLoop to ask ChatGPT to review server.js, with background true,
    mode auto, and reviewResponseMode analyze-only. Read the saved response.

`--headless` / MCP `headless: true` runs without a window and is a separate option. It requires `auto` and cannot be combined with `background`. **Do not use it for ChatGPT at present:** live checks with both authenticated and anonymous profiles were blocked by site verification; earlier trials received HTTP 403. The flag remains available for diagnostics, and passing local browser fixtures does not establish live support. Use `--background`. GiviLoop reports the block and stops rather than retrying it automatically.

Both modes reuse the dedicated profile. Use `--browser-profile PATH` / MCP `browserProfile` for another **dedicated** profile, and pass the same path to `browser login`. Do not run two browser jobs on one profile at the same time. See [troubleshooting](troubleshooting.md) for login, blank windows, busy profiles, and provider errors.

For longer tasks, `--max-wait-ms N` / MCP `maxWaitMs` sets the response timeout (default 180000). `--navigation-timeout-ms N` / MCP `navigationTimeoutMs` sets each navigation attempt (default 20000); only failures before submission may receive one navigation retry. `--response-stable-ms N` / MCP `responseStableMs` controls the final text stability interval (default 5000).

Human verification has a separate `--verification-wait-ms N` / MCP `verificationWaitMs` budget (default 180000 explicitly visible, always 0 quiet/headless). Configure the MCP caller's own request timeout to cover verification plus generation; cancellation stops the pending run instead of continuing a hidden request.

A timeout never saves an unconfirmed partial response as a completed review. After an uncertain send or response timeout, inspect the conversation before explicitly retrying: GiviLoop does not send the prompt again automatically.

`prefill` only fills the composer; `submit` also sends but does not retrieve the answer. These modes keep a visible browser open and cannot use `background` or `headless`. The development `npm run chatgpt:web` wrapper uses the same implementation and defaults to `prefill`.

### Manual Flows

For an assisted workflow with the provider's regular website:

    npm run givi -- ask --repo /path/to/repo --file server.js --question "Review this code"
    npm run givi -- copy --repo /path/to/repo --open
    # In your regular browser: paste, send, then manually copy the provider's answer.
    npm run givi -- ingest --repo /path/to/repo

`copy --open` copies the prepared prompt and opens the target provider in your default browser. It does not control the page, submit the request, or read the answer from the website. `ingest` reads the text you explicitly copied to your local clipboard and records the provider from the request metadata.

On macOS, click the chat input, press **⌘V**, then send. When the answer is complete, click **Copy** under that answer before running `ingest`. On Windows/Linux, paste with **Ctrl+V**.

By default, `copy`, `ingest`, and `send` use the latest run. When preparing multiple reviews, use the ID from `.giviloop/runs/<run-id>/` to keep each answer attached to its request:

    npm run givi -- copy --repo /path/to/repo --run-id <run-id> --open
    npm run givi -- ingest --repo /path/to/repo --run-id <run-id>

Pass the same ID as `runId` to MCP's `givi_read_external_review`. A missing response is reported as missing; another run's response is never substituted.

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

- `archive` is the optional ChatGPT source-archive entry point. It creates `source-context.zip`, `source-manifest.json`, `external-review-request.md`, and metadata. With `--send chatgpt-web --mode auto`, it uploads the zip, sends the request, and saves the response in the same run.
- `ask` creates a focused question run with selected text files. Add `--send` and a supported provider to retrieve and save a review automatically.
- `prepare` is the Git-change review path. It creates a review package from git diff and untracked files, but does not send it by itself.
- `send` sends a prepared run to a selected local runtime or browser chat. Use `--run-id` to select a particular request. Only the ChatGPT web path accepts source archives; it automatically attaches `source-context.zip`.
- `copy` and `ingest` are the manual fallback pair. Use them for Claude today, provider UI issues, or cases where you want to paste and review before sending.

Browser destinations are `chatgpt-web`, `deepseek-web`, `claude-web` and `gemini-web`, each with its own default profile. A prepared run must match its destination (`--target-provider NAME-chat`); `ask --send NAME-web` infers the target. New adapters accept inline text, with ZIP uploads and automatic model selection limited to ChatGPT. Signed-in Claude Free/DeepSeek and anonymous Gemini generation have been exercised; DeepSeek failed the corrected-code quality control. These are a few disclosed cases, not a model ranking. See [provider commands and validation](web-providers.md).

## Output Files

GiviLoop stores local run data under .giviloop/.

Each run contains:

- metadata.json
- external-review-request.md

Runs completed in `auto` mode or imported with `ingest` also contain external-review-response.md.

Review-package runs also include review-package.md.

Source-archive runs also include source-context.zip and source-manifest.json. With `--send chatgpt-web --mode auto`, GiviLoop attaches the zip to ChatGPT web automatically, includes the manifest inline in the prompt, sends the request, and saves the response.

The latest run id is stored in .giviloop/latest-run-id.

During normal run cleanup, GiviLoop keeps the 10 most recent completed, inactive runs and prunes older completed runs. Pending runs, active browser jobs and runs with a `findings.json` evidence ledger are preserved. Remove evidence-bearing runs deliberately when no longer needed.

Local runs contain `local-status.json` and `local-usage.json`. A shared `review.lock` prevents browser and local transports from writing the same run simultaneously. Interrupting CLI inference or cancelling an MCP request releases the lock; after a force-killed process, remove a stale lock only after verifying its recorded PID has stopped.

Browser runs also contain `browser-status.json`: stage, outcome, timestamps, profile path, request hash, and whether submission is known to have happened. It does not contain cookies or response text. The outcome can be `failed` while `submitted` is `true` or `"unknown"`; this distinction prevents accidental duplicate sends.

Add this to your gitignore:

    .giviloop/

It can contain prompts, repository context, review packages, run metadata, and external responses.

## Providers

Implemented now:

- ChatGPT prompt generation
- Claude prompt generation for manual and MCP flows
- Local Ollama inference
- Local DwarfStar inference through its native HTTP server
- Local llama.cpp and LM Studio inference
- Experimental MLX-LM inference on Apple Silicon
- Optional browser automation through native Chrome and Playwright; [validation by provider](web-providers.md)

Claude is currently available through the manual copy/ingest workflow.

Request a model with `--model "EXACT LABEL"` / MCP `model`. Without `--require-model`, failure produces a warning and uses the currently selected model. With `--require-model` / MCP `modelSelection: "require"`, GiviLoop requires an exact menu label and visible selection confirmation before sending. This verifies the UI label, not the underlying model identity or reasoning budget. Authenticated selection has not yet been exercised against the live site in this release.

## MCP Tools

Most users should use natural-language IDE prompts, but the MCP tools are:

- givi_help
- givi_local_models
- givi_ask_local_llm
- givi_send_to_local_llm
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

GiviLoop has basic omission and redaction rules for common sensitive files and secret-like values, but it is not a real secret scanner.

Source archives use git's exclude rules by default and omit common generated, binary, lockfile, credential, and symlink paths. Archive file contents are not line-by-line redacted, so do not archive repositories that contain secrets in tracked source files.

Use it only with repositories and providers you are comfortable sending to an external LLM.

Use provider web automation only if it is allowed by the provider terms and by the account or workspace policies that apply to you.

The MIT license covers GiviLoop; it does not grant permission to automate third-party services. Each user is responsible for their accounts, content, and applicable provider terms. Choosing an optional integration does not establish that the provider permits it. For the web-chat workflow, `copy --open` followed by manual submission/copy and explicit `ingest` avoids automatic collection of website responses. See the [costs and access guide](costs-and-access.md) for the distinction between this workflow, browser automation, and local inference.

Before sending code or context to an external provider, make sure that doing so is allowed by your organization, client agreements, confidentiality obligations, and the provider terms that apply to your account.

Optional hardening: set `GIVILOOP_ALLOWED_REPOSITORIES` to a path-delimited list of repository roots that may be sent through web LLM automation.

You are responsible for deciding what can be shared externally. GiviLoop helps package and transmit content; it does not decide whether that transfer is permitted.

## Guided setup and finding evidence

Use `givi setup` for prerequisites, saved provider/preferences and an MCP snippet. `givi review` prepares and sends using those defaults; `givi ask` and `givi prepare` remain prepare-only unless sending is explicit. `givi status`, `open`, `resume` and `cancel` control attention and active reviews. `givi findings add|update|list` records assessments and evidence; `givi recheck` prepares fresh context for one finding. MCP exposes `givi_record_finding`, `givi_list_findings` and `givi_prepare_recheck`. See the [complete setup and evidence guide](setup-and-evidence.md) for commands and limitations.

## First-use demo and portable report

`givi demo --offline` runs a labeled authored example without an account. `givi demo` uses the saved provider and sends only the bundled public source, then runs its fixed reproduction. `givi demo --finish` completes an interrupted demo after explicit login/resume without another submission. It never executes model-generated code.

`givi report [--run-id ID]` / MCP `givi_export_report` exports current effective findings, evidence and hashes to the run's `double-check.md`. `--stdout` prints without saving; `--json` returns metadata and Markdown. Saved reports protect their runs from automatic retention cleanup. Inspect before sharing; no publishing or general test execution occurs. See the [before-commit recipe and first-use walkthrough](double-check.md).
