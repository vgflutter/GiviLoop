# Automatic review at task completion

Enable a second opinion after the coding agent finishes a change and its checks, without asking for a review each time. The goal is an independently verified issue or a brief, honest result, with evidence available when needed.

## Enable once per project

```sh
givi setup --repo /path/to/project --provider claude-web --non-interactive
givi auto-review enable --repo /path/to/project
```

For local inference, setup with `--provider ollama --model YOUR_INSTALLED_MODEL` (or another supported local runtime). Use `npm run givi --` in a source checkout. Setup generates `.giviloop/mcp.json`; connect that server in your client. Web login, when needed, remains a separate initial setup step.

Enable adds a bounded section to the project's `AGENTS.md`, preserving other instructions, and saves local consent plus a copy of the reviewer configuration in `.giviloop/auto-review.json`. It forces background browser mode. Later changes to ordinary setup preferences do not silently change the automatic destination: enable again to adopt them. Enable itself sends nothing. Keep `.giviloop/` ignored; another checkout must enable independently even if it receives the shared AGENTS.md rule.

Start a new agent session after changing instructions. Codex loads project instructions at session startup; nested overrides and instruction size limits can affect what it reads. [Official instruction-loading documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

**This is instruction-driven, not an IDE completion hook, daemon or file watcher.** The agent must load the rule, have the MCP tool and follow it. GiviLoop cannot force a host to call a tool. Other clients can adopt the same rule through their supported instruction mechanism; automatic installation currently targets AGENTS.md only. No extra API key is required by this feature.

## What happens

1. The agent finishes a code task, runs appropriate checks and selects that task's changed source/test files. Unrelated user changes must not be selected.
2. It calls `givi_auto_review` with `repositoryPath`, `files`, one stable `taskId` and `checks: passed | not-applicable | failed`. These checks are **the host's attestation**, not test execution by GiviLoop. Failed checks skip the submission without consuming the task.
3. GiviLoop sends the selected diff and current source to the reviewer pinned at enable time. No provider fallback occurs. The browser is minimized, not headless.
4. The host reads the response with `givi_read_external_review`, independently verifies concrete claims, records them with `givi_record_finding`, then exports with `givi_export_report`. Model-suggested commands are advisory data, never automatically executed. Fixes need authority from the original task.

Use a new ID for each new user task, preserving it across corrections, compaction and retries. The persistent guard prevents a second submission for that task even if a review fix changes the diff. An identical source snapshot is also deduplicated across tasks and process restarts. IDs are hashed in local history. Deleted/corrupted history cannot provide these guarantees; corruption is rejected instead of silently reset.

Completed delivery means **awaiting independent verification**, not “passed.” An empty findings ledger is not proof of clean code. The host should surface confirmed issues and material uncertainty, otherwise use one short accurate line. Skipped, blocked and unassessed results must remain visible as such. `sourceChanged` warns if the selected source or base commit changed during review or since a reused review.

## Scope and limits

- Git repository root with an initial commit. Compares the current worktree/staging result with HEAD, plus eligible untracked files; this is not a whole-branch review. Staged content superseded by unstaged edits is not separately reviewed.
- MCP requires an explicit file list. CLI `auto-review run` without `--file` considers all eligible changed code, so select files when the workspace contains unrelated changes.
- Common source/test extensions are supported. Documentation, generated/dependency directories, configuration files, binaries and obvious credential paths are excluded. Returned `files` and `skippedFiles` show scope. There is no AST-based formatting detector: whitespace edits in code are still eligible, since indentation can change behavior.
- A maximum of 100 files, 60 KB per current file and 120 KB combined context. Larger selections fail before transmission rather than silently truncating. Missing callers/contracts may still limit the reviewer; use a manual focused review for extra context or unsupported paths.
- Redaction is best effort, not a guarantee that code is secret-free. Review repository/provider suitability before enabling. Existing web terms and quota limitations remain; local inference is an alternative. Total token savings are unmeasured.
- One active automatic operation per checkout. Concurrent calls report busy. The transport remains bounded and cancellable; CLI exits close Chrome, MCP may reuse a healthy session briefly. No general promise of invisible Chrome on every desktop.

## Inspect, pause and recover

```sh
givi auto-review status
givi status --run-id RUN_ID
givi auto-review disable
```

Disable removes the managed instruction section and revokes local enablement; it retains evidence and history. An active operation owns the configuration lock: cancel with `givi cancel --run-id RUN_ID`, wait for its worker to close, then disable. Don't delete locks while their worker is active.

Login, CAPTCHA, delivery errors, cancellation and interrupted attempts suspend further automatic submissions across tasks. Repeating enable does not clear that history. For a known **not-yet-submitted** browser request, explicitly use `givi open --run-id RUN_ID`, finish setup, quit Chrome, then `givi resume --run-id RUN_ID`. Resume checks submission state and the request hash. It uses the original snapshot: inspect newer edits before treating the response as current.

If the failed attempt cannot be resumed, inspect its status and the provider's conversation first. Then explicitly acknowledge that stopped attempt:

```sh
givi auto-review acknowledge --run-id RUN_ID
```

This allows **new tasks with changed snapshots**, without resending, certifying or deleting the old attempt. The same task/snapshot remains deduplicated. For a deliberate retry of the same code, use an explicit manual review after inspection. Never have the agent acknowledge failures automatically just to continue. Automatic run records survive ordinary cleanup; keep or deliberately archive them with their history. History is bounded to 2,000 attempted reviews before manual archival is required.

## Verify your setup

After enabling and restarting the agent, ask it for an ordinary small code change, without mentioning GiviLoop. Check that it calls `givi_auto_review` once, reads the response, verifies findings and reports the real outcome. Inspect `givi auto-review status`, the run's metadata and exported report. A second invocation for that task must return `task-already-reviewed` without opening Chrome; docs-only selections should send nothing. If the host never calls the tool, inspect loaded instructions/MCP configuration; enabling alone is not proof the host lifecycle works.

Development tests exercise policy installation, scope/redaction, duplicate suppression across CLI/MCP, concurrency, stale source, failed-check skipping, interrupted/failed history, cancellation and browser attention/resume. Provider-shaped browser fixtures exercise the real Chrome transport, not model accuracy. See the [validation note](releases/0.8.0.md#live-validation-2026-09-23) for the separately recorded live check.
