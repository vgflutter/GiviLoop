# Measuring agent tokens

The hypothesis is testable: **replacing a separate agent self-review with a web
review might reduce the calling agent's work**. It is not the same as reducing
total model computation or subscription costs. Do not assume an agent always
performs a separate second review by default.

[First measured pilot: ten real sessions, four Claude reviews](benchmarks/token-pilot-2026-09-27.md).
All independent acceptance checks passed, but GiviLoop consumed more observed
agent tokens than internal self-review. The instruction to avoid duplicate
review reduced aggregate tokens versus normal GiviLoop while increasing uncached
input and output. This does not establish lower cost or quota consumption.

## Reproduce the comparison

From a source checkout, with Codex CLI authenticated and the chosen browser
profile ready:

```sh
npm ci
npm run build
node scripts/token-benchmark.mjs
node scripts/token-benchmark.mjs --run-live \
  --model YOUR_CODEX_MODEL --effort YOUR_REASONING_EFFORT \
  --provider claude-web --browser-profile /absolute/path/to/dedicated/profile
```

The first invocation only prints help. `--run-live` uses your existing Codex
and website quotas: ten fresh coding sessions, including four web reviews.
It requires no model API key. Browser access remains subject to the
[same access limitations](costs-and-access.md) as other GiviLoop workflows.

Each session gets the same public task and starting code in a fresh Git
repository. The five instructions are:

| Arm | Additional instruction |
| --- | --- |
| Normal | None: ordinary coding and tests. |
| No second review | Explicitly skip a separate second review; still test and fix failures. |
| Self-review | Explicitly review the implementation again after tests, fix concrete issues and retest. |
| GiviLoop | Use GiviLoop as the second pass, verify returned claims, record the assessment and fix confirmed issues. Do not do a separate full self-review first. |
| GiviLoop normal | Ordinary coding prompt with automatic review enabled in `AGENTS.md`, without the explicit instruction to avoid a duplicate self-review. |

The two tasks implement proportional integer allocation and an LRU cache with
TTL. Their independent acceptance checks cover 27 allocation cases and 10 cache
scenarios. Those checks run outside the coding workspace after the session ends;
the agent's own tests alone do not establish correctness. The fixture contracts
and acceptance checks are public in `scripts/benchmarks/token-tasks.mjs`.

Model and reasoning effort are pinned. Arm order is reversed on the second task.
The current server uses the [eight-tool default](mcp-tools.md); the historical
pilot linked above used twenty. Record the tested checkout when comparing runs.
Only the two GiviLoop arms load their actual project instructions and MCP integration;
their overhead is part of the measured workflow. The benchmark preserves checks
and evidence verification: skipping those to reduce tokens would change the
product being tested.

## What the numbers mean

The runner reads the single successful `turn.completed.usage` event from each
fresh `codex exec --json` session. Missing or failed usage is not zero.
[Codex JSON output](https://learn.chatgpt.com/docs/non-interactive-mode).

- **Observed agent tokens** = `input_tokens + output_tokens` over that session.
  Repeated context on successive model calls contributes again.
- **Uncached input** = `input_tokens - cached_input_tokens`. Cache reads are
  already part of input, not extra tokens. Cache writes, if reported, remain
  within uncached input.
- **Output** includes reasoning where reported; reasoning is shown as a subset,
  never added again. [Token counting](https://developers.openai.com/api/docs/guides/token-counting),
  [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
- **Paired delta** = baseline minus GiviLoop, on the same task. A negative value
  means GiviLoop consumed more observed agent tokens. Percentages divide that
  delta by the baseline; a zero baseline has no percentage.

Web reviewer tokens, total workflow tokens, actual money, and subscription quota
consumption stay **unknown**. All five arms use an existing Codex login; this
experiment does not purchase an API review as a control. It therefore cannot
count an avoided paid API call or price the difference.

Logs, prompts, patches, acceptance results, source commit, task hashes,
incremental `summary.json`, `public-results.json` and `report.md` are saved under
ignored `.giviloop/diagnostics/`. Public results omit private diagnostic paths
and tool output. Inspect them before sharing. `--arms` selects a comma-separated
subset of the arm names shown by the help command; keep failed attempts in any
combined report rather than selecting only successful samples.
Existing output directories are refused to avoid overwriting failed attempts.
Every attempt remains in the report. A failed quality check or incomplete web
review is explicitly ineligible for a comparable savings claim.

## Limits of this pilot

Two tasks, one observation per task and arm, are useful for finding overhead and
checking the measurement process. They do not establish a general savings rate,
model ranking or statistical significance. Caching, server variability, code
choices and stochastic reasoning affect results; reversing order cannot remove
all of those effects. The tasks are small synthetic implementations, not large
maintenance changes. The available web model is not guaranteed to match the
agent model.

A normal agent's internal decision to recheck its answer is not directly
observable. Comparing prompts tests the resulting workflow and usage, not a
fixed hidden "default second review" cost. Repeat on representative tasks before
using a percentage in promotion, and publish failures alongside successes.

The direct prompt comparison is `giviloop-normal` versus `giviloop`: both load
the same GiviLoop configuration. The other arms give useful baselines but also
differ in tool availability. None of these comparisons isolates reasoning alone
or guarantees identical generated code beyond the acceptance checks.
