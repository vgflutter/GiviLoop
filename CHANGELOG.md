# Changelog

Release summaries. Historical validation reports and full development notes remain in Git history. For current commands and limitations, see the [usage reference](docs/usage.md) and [provider results](docs/web-providers.md).

## Unreleased

- Background CLI/MCP reviews use hidden top-level pages in ordinary Chrome, supported by a bundled offscreen extension loaded through DevTools. Saved dedicated profiles and native cookie encryption are preserved; no manual extension installation is required.
- Windowless startup failure stops with `WINDOWLESS_UNAVAILABLE` instead of opening a minimized or visible fallback. Login, verification and uploads retain their explicit foreground workflow.
- Verify hidden pages across restarts, concurrent profiles, new pages, session reuse and installed-package execution. Pin Playwright 1.61.1 for its internal hidden-target attachment support.
- macOS validation includes ten ordinary-Chrome restarts and two real anonymous ChatGPT MCP reviews with no visible browser window or foreground activation sampled. Windows/Linux VM and authenticated windowless provider checks remain pending. [Evidence and limits](docs/windowless-browser.md).

## 0.8.2

- Finding writes require an explicit review ID: CLI `--run-id`, MCP `runId`. Missing/invalid IDs fail before changing a ledger; reads retain their latest-run default.
- Finding IDs are scoped to their review. New reviews preserve earlier findings and decision history.
- Upgrade scripts that omitted the write ID, restart MCP, and rerun `auto-review enable` to refresh managed instructions (`--client codex` where appropriate). Existing ledgers need no migration.

## 0.8.1

- `auto-review enable --client codex` installs project-local MCP configuration and approvals for the six workflow tools, preserving unrelated settings and project trust.
- Automatic invocation was observed in fresh Codex CLI sessions using signed-in Claude on macOS, without a review request in the coding prompt. This validates that tested client/configuration, not every frontend.
- Retained minimized native Chrome after a windowless prototype failed login/resume checks. Universal window invisibility is not guaranteed.

## 0.8.0

- Optional task-end review through `givi auto-review enable`, project instructions and MCP.
- Pinned reviewer, persistent task/snapshot deduplication and explicit recovery. Activation depends on the host loading and following instructions; no daemon or automatic fixes.

## 0.7.0

- Offline and live public demos with a bundled independent reproduction.
- Portable Markdown reports, stale-assessment warnings and before-commit workflow.
- Validate persisted verdicts so corrupted ledgers cannot yield a misleading report.

## 0.6.0

- Saved project preferences and one-command `review`.
- `status`, `open`, `resume` and `cancel` through CLI/MCP; resume only for unchanged requests proven unsent.
- Automatic web delivery defaults to `auto` and background mode. Use `--mode prefill` for composer-only behavior or `--foreground` for visible interaction.
- Bounded MCP browser reuse with separate conversations and 60-second idle expiry; CLI closes its browser after each review.

## 0.5.0

- Guided setup and local MCP configuration snippet.
- Persistent findings, evidence, decision history, source hashes and stale detection.
- Targeted recheck preparation and a recorded public demo. Verification remains the host agent's responsibility.

## 0.4.0

- Browser adapters for Claude, DeepSeek and Gemini alongside ChatGPT, with provider-specific discovery and validation.
- Text review support for the additional adapters; automated ZIP upload and model selection remain ChatGPT-specific.

## 0.3.1

- Fixed completed reviews leaving the CLI alive when Chrome helpers inherited its stderr pipe.
- Reproducible example, live-check and recording scripts.

## 0.3.0

- Native Chrome transport for visible/background reviews, with owned-process cleanup and bounded recovery.
- Local runtime integrations and manual web transfer alongside experimental browser review.
- Packaged CLI/MCP distribution and repeatable installed-package/browser checks.
