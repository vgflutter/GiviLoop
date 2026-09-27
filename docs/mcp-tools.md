# A smaller MCP interface

The server advertises **eight tools by default**, down from twenty. It supports
ordinary user-requested reviews and opt-in automatic reviews with both web and
local reviewers. The CLI remains available for detailed setup and preparation.

| Tool | Purpose |
| --- | --- |
| `givi_review` | Create and send a review with the project's saved reviewer. |
| `givi_auto_review` | Existing enabled automatic check with stable task identity. |
| `givi_read_external_review` | Read the selected response. |
| `givi_record_finding` | Add or update a finding with its explicit run ID. |
| `givi_list_findings` | Inspect findings, history and stale evidence. |
| `givi_export_report` | Export the recorded assessment. |
| `givi_status` | Read progress and the next action. |
| `givi_manage_review` | Grouped recovery and preparation actions. |

## Request a review

Configure the reviewer once with `givi setup`. Then call:

```json
{
  "repositoryPath": "/absolute/project",
  "question": "Find concrete bugs. Only nonempty arrays are valid.",
  "files": ["src/allocation.ts", "test/allocation.test.ts"]
}
```

`givi_review` sends immediately. Omit `files` to review Git changes. It uses the
saved provider, local model and browser profile; web sessions are always windowless,
even with a saved foreground preference; its response handling is
analyze-only. Verify returned claims before making authorized changes. Keep its
exact run ID for every subsequent read, finding and report.

To send an already prepared request, pass only `repositoryPath` and `runId`.
It refuses a completed, interrupted, locked or attention-required request; this
is not a retry shortcut. No new review is created for a prepared request.

Automatic review remains `givi_auto_review`, with its existing enable/skip/check
and deduplication rules. Never substitute `givi_review` after an automatic check
stops or skips. The installer still preapproves only the same six workflow tools;
manual send and management are not added to that automatic permission list.

## Manage a review

`givi_manage_review` accepts an `action`:

- `cancel`, `resume`: require `repositoryPath` and the exact `runId`.
  `resume` preserves the existing no-resend checks and always runs windowless.
  There is no `open` action or `foreground` option.
- `recheck`: also requires `findingId`, with optional extra `files`. Creates a
  new prepared request without sending; its returned run ID belongs to the recheck.
- `models`: requires `repositoryPath`; lists models from the saved local runtime.
- `release-browser`: closes idle browsers owned by this server; active reviews
  are left running. Requires no repository.

Use `givi_status` for routine progress; it has no browser side effect.

Login, cookie choices, verification and ZIP uploads pause with `needs-attention`.
The user handles login/setup manually in a terminal:

```sh
givi open --repo /absolute/project --run-id RUN_ID
```

Close that Chrome normally, then ask the agent to resume the same review. For a
ZIP upload, the user runs `givi resume --repo /absolute/project --run-id RUN_ID
--foreground` manually. Agents must not use visible CLI commands as a fallback.
Chrome may still have a Dock/taskbar icon; windowless refers to the review window.

## Advanced and existing integrations

Default server arguments are still just the path to `dist/mcp-server.js`.
To discover all 21 tools, add `"--tools", "full"` after that path. `--tools compact`
is the explicit spelling of the default. Unknown profile options fail at startup.
The full profile includes advanced tools and the two new entry points;
`givi_open` has been removed.

Discovery alone is not an access-control boundary. Older named review calls
remain available, but all MCP profiles enforce the same windowless behavior.
Explicit visible/headless overrides, `prefill`/`submit` modes, verification waits
and `givi_open` calls now fail before a browser launch or submission. Harmless
legacy arguments (`mode: "auto"`, `background: true`, `headless: false`,
`verificationWaitMs: 0`) are accepted but no longer advertised. New sessions discover
the smaller list. Restart/reconnect the MCP client to refresh a cached tool list.
Advanced preparation without sending, conversation context, provider/model
overrides and inference tuning remain available through the full profile or CLI.
Visible recovery and headless diagnostics are CLI-only. Existing skills should use the updated review recipe.

Fewer advertised definitions reduce serialized schema context. This does **not**
establish a proportional reduction in session tokens, money or subscription quota.
The [earlier token pilot](benchmarks/token-pilot-2026-09-27.md) used the previous
20-tool interface; its results are historical, not measurements of this change.

## Validation in this checkout

A protocol `tools/list` check measured 8 definitions and 5,895 serialized JSON
characters, versus the previous 20 definitions and 22,778 characters (about 74%
less description/schema text). This is a size measurement, not a tokenizer or
billing measurement.

A real Claude web review through `givi_review` completed in windowless Chrome
using only two public synthetic files. It identified the deliberately omitted
first array element. Three independent Node assertions reproduced the behavior;
one confirmed finding and its report were saved with the same run ID. Mock local
runtime integration also covers file review, Git review, contract transmission,
prepared recheck delivery and refusal to resend a completed review.

A fresh Codex CLI session with the default eight-tool server also completed an
ordinary `average(xs)` coding request without mentioning review in the prompt.
It invoked `givi_auto_review` once, read and assessed the real Claude answer,
recorded its assessment and exported the same review's report. Five independent
assertions passed. This validates automatic invocation in that client/configuration;
it does not measure a general token-saving rate.

Publication validation on macOS / Node 22: **240 tests passed against the
installed package**, **all 65 browser tests passed without skips**, and the
skill validator passed. The additional six-operation HOL CLI contract regression
also passed. The browser run included the 10 cases that deliberately show Chrome
for manual recovery; CI explicitly includes them too. Use
`npm run test:browser -- --foreground` to include manual recovery and visible
window lifecycle cases on CI desktops only (`CI=true`). Local foreground test
commands and desktop-observer calibration are blocked before opening Chrome.

Additional checks reject legacy visible routes before side effects and cover
verification pauses, archive resume and saved foreground preferences. A fresh
real Claude review completed with `visibility: windowless` despite a deliberately
saved `background: false` preference. Three independent assertions confirmed the
review's seeded defect. These checks cover this checkout, not a published release
or a guarantee for every client/provider. No website verification was bypassed.
