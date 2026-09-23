# Double Check with GiviLoop

Ask a second model to challenge a change, then have your coding agent check the findings before acting on them. This workflow uses the existing CLI/MCP tools. **There is no `givi double-check` command or built-in test-verification engine yet.**

## Start from your coding agent

Connect the GiviLoop MCP server as described in the [README](../README.md#use-it-from-your-coding-agent). For the optional browser integration, complete `givi browser login`, close the dedicated Chrome window, and check access with `givi browser check`. Read the [access conditions](costs-and-access.md), then use:

```text
Double-check my current Git changes with GiviLoop.
Use ChatGPT web in auto mode with background enabled.
Ask for concrete correctness bugs, the relevant code, and a regression case.
Read the saved review in analyze-only mode.
Check each finding against the source and available test evidence.
Report confirmed, dismissed, and unverified findings, with reasons.
Do not edit files or apply the review automatically.
```

The agent can call `givi_prepare_from_git`, `givi_send_to_web_llm` with `webProvider: "chatgpt-web"`, `mode: "auto"`, `background: true`, then `givi_read_external_review`, keeping the same `runId` and `reviewResponseMode: "analyze-only"`. The last option applies to send/read, not preparation. A focused review can use `givi_ask_web_llm` with `attachedFiles` directly. The MCP caller's timeout must cover navigation, verification and the response budget.

For an **automatic local review**, replace the second prompt line with `Use Ollama with MODEL_FROM_DISCOVERY as the reviewer.` Discover the exact installed model using `givi_local_models`; send with `givi_send_to_local_llm` or ask with `givi_ask_local_llm`. For the tested Qwen3 4B Ollama profile: `reasoning: "on"`, `contextTokens: 16384`, `maxOutputTokens: 8192`, and `maxWaitMs: 300000`.

For **manual web transfer**, prepare with `givi prepare`, copy with `givi copy --open`, paste and send on the website, copy its answer, then run `givi ingest`. Keep the printed `runId` through copy/ingest/read. These site interactions are manual; the rest of the Double Check workflow is the same.

`prepare` currently collects changes relative to `HEAD`, plus included untracked files. It does not represent the entire branch relative to its merge base. For a focused question, use `givi_ask_local_llm` with `attachedFiles` instead.

`analyze-only` and `act` are handling instructions for the calling agent. GiviLoop saves and returns the review; the agent carries out analysis, edits and tests under its own permissions. A text instruction is not a sandbox or a guarantee of verification.

## What counts as a useful finding?

| Outcome | Evidence to report |
| --- | --- |
| Confirmed | Relevant source and a concrete failing case, reproduction, or a directly demonstrated contradiction of the contract. |
| Dismissed | Why the claim does not hold: a guard already exists, a premise is wrong, or a reproduction disproves it. |
| Unverified | What is missing: caller behavior, environment, test access, or enough context to decide. |

A second model agreeing is additional advice, not proof. A green existing test suite also does not establish that a newly reported edge case is covered. Preserve uncertainty instead of turning an unfinished check into a clean verdict.

GiviLoop persists these assessments with evidence, history and referenced file hashes. Changed referenced source marks the assessment stale. The host agent supplies the verification; recording a verdict does not certify it.

## A small reproducible example

[`examples/double-check/sum.ts`](../examples/double-check/sum.ts) intentionally omits the initial value from `reduce`. Its stated contract requires `sum([]) === 0`.

```diff
- return values.reduce((total, value) => total + value);
+ return values.reduce((total, value) => total + value, 0);
```

The original throws on an empty array. The proposed change returns zero and preserves the results for `[5]`, `[1, 2, 3]`, and `[-2, 3, -1]`. This is a known synthetic example, not evidence that GiviLoop found an unknown production bug or outperforms the coding agent's own review.

The actual [CLI/MCP browser checks](chatgpt-403-resolution-2026-09-21.md) and [local-runtime checks](production-validation-2026-09-21.md) include this class of fixture, saved responses and independently checked corrections. They also record incorrect and misleading model advice. Use those failures to understand why verification matters.

The local quickstart fixture was also run on 21 September 2026 with Ollama and `qwen3:4b`: it completed in 60.8 seconds with 204 input and 3,660 generated tokens. The reviewer identified the empty-array bug and the minimal fix correctly; the source file remained unchanged. Its additional claims that TypeScript eliminated type-related risks and the change had no runtime cost were not established by the review. Those claims should not be accepted as evidence of production readiness. The proposed correction was checked separately against the empty-array case and three nonempty examples.

## Applying a confirmed fix

After reviewing the findings, instruct your agent to apply only the selected corrections, reproduce the failing case, and run the relevant regression checks. The MCP response reader accepts `reviewResponseMode: "act"`; it tells the agent to evaluate the advice and report accepted and rejected findings. It does not apply patches itself.

If you want verification tests added or executed, include that in your instruction and scope it to the repository. Any isolated worktree or test execution is currently managed by the coding agent, not GiviLoop.

## What a dedicated feature would add

Structured findings, source hashes, stale detection, targeted rechecks and portable Markdown reports are available. An embedded general-purpose verification runner is still future work; it would need isolation, bounded execution and repository-specific commands. See the [prioritized roadmap](roadmap.md).

## Keep the verification result

After independently checking each claim, save it with `givi_record_finding` (or `givi findings`), always passing the original review `runId` (`--run-id` in the CLI). Include source/contract/test files, the confirmed/dismissed/unverified status, a reason and actual evidence. `givi_list_findings` reports changes that make an assessment stale. `givi_prepare_recheck` prepares current context for one finding; sending and verifying are explicit next steps. GiviLoop records the host agent's assessment, not a machine-certified result. [Commands and examples](setup-and-evidence.md).

Use the [before-commit recipe](before-commit.md) and `givi report` / `givi_export_report` to finish with a portable report. `givi demo --offline` teaches this flow without an account; `givi demo` uses the configured real reviewer.
