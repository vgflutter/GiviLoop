# Browser providers: commands and validation

Updated 22 September 2026. All integrations below use the website in a dedicated Chrome profile. **No API key, API inference endpoint or paid fallback is introduced.** Existing local inference adapters remain separate.

| Destination | Real website evidence in this change | Scope |
| --- | --- | --- |
| `chatgpt-web` | Authenticated CLI review completed in 20.6 s; fresh anonymous MCP diff review completed in 16.1 s. | Text; existing ZIP uploads and model selection. Headless remains blocked in prior live checks. |
| `gemini-web` | Anonymous CLI review completed in 27.4 s; fresh-profile MCP diff review in 19.9 s after the cookie setup fix. | Text; current/default website model. Authenticated models and long reasoning not tested. |
| `deepseek-web` | Fresh profile reached `/sign_in`; no anonymous composer. | Experimental text adapter, tested with fixtures. Authenticated response DOM and generation **not live-validated**. |
| `claude-web` | Fresh profile reached `/login`; no anonymous composer. | Experimental text adapter, tested with fixtures. Authenticated response DOM and generation **not live-validated**. |

The two new login profiles were opened for the account holder. Login, MFA and human verification remain manual when required. The implementation does not solve challenges, repeat blocked taps, copy cookies between profiles or bypass authentication. A successful fixture is not evidence that a provider's current authenticated UI works.

## Use a browser provider

After `npm run build`, choose one destination. For example, DeepSeek:

```sh
npm run givi -- browser login --provider deepseek-web
```

Sign in in that window, then quit its Chrome normally. Run:

```sh
npm run givi -- browser check --provider deepseek-web
npm run givi -- ask --repo . --file examples/double-check/sum.ts \
  --question "Find a concrete bug, the smallest fix and regression tests." \
  --send deepseek-web --mode auto --background
```

Replace `deepseek-web` with `chatgpt-web`, `claude-web` or `gemini-web`. Login is unnecessary if `browser check` finds an accessible anonymous composer. A fresh profile can be selected with `--browser-profile PATH`; use the same path for login, check and send. `doctor --provider NAME-web` diagnoses the matching profile without visiting the site.

For Git changes, prepare the matching target first:

```sh
npm run givi -- prepare --repo . --goal "Review the changes" --target-provider gemini-chat
npm run givi -- send --repo . --send gemini-web --mode auto --background
```

A destination mismatch stops before sending. New providers reject automatic `--model` selection and ZIP attachments explicitly. `ask --file` embeds selected source text; it does not upload those files. Their model is whatever the website offers/selects in the new conversation; the adapter does not certify its identity or reasoning level. `prefill` and `submit` are also available and leave Chrome open.

For MCP use `givi_ask_web_llm` with `webProvider: "gemini-web"`, or prepare with `targetProvider: "gemini-chat"` and send with `givi_send_to_web_llm`. The existing ChatGPT compatibility alias remains ChatGPT-only. All providers save to the same run format, so `givi_read_external_review` works unchanged. Manual `copy --open` and `ingest` support all four targets.

## What was exercised

- Four complete product runs: ChatGPT authenticated CLI and anonymous MCP; Gemini anonymous CLI and fresh-profile MCP. An earlier Gemini UI exploration also completed a small synthetic review. No private repository files or credentials were submitted.
- Gemini initially failed before sending when its cookie dialog was animated in a minimized window. The fix temporarily restores Chrome, rejects optional cookies, waits for dismissal, and minimizes again before sending. The corrected fresh-profile MCP run completed.
- The MCP runs prepared an actual synthetic Git diff, saved and read the response, and verified the source stayed unchanged. Seven independent cases reproduce the `slice(-0)` regression and validate the intended fix; generated code was not executed.
- New browser fixtures cover CLI/MCP round trips for all three new adapters, destination selection, login redirects, partial answers, user/code-copy controls, and first-use Gemini setup. Existing ChatGPT browser, upload, model, cancellation and challenge tests remain in the suite.
- Profiles and raw DOM diagnostics stay local and excluded from Git/npm. Reports contain status/provider/hash, not cookies or prompt text. Web token consumption and total savings remain unknown.

DeepSeek/Claude full generation, authenticated Gemini, subscription model selection, long reasoning, and headless access on the new sites remain unvalidated. The new providers are experimental; this is not a production certification for all four websites. Provider UI/language changes can require selector updates and should fail without saving an unconfirmed response.

## Repeatable acceptance check

From a source checkout, build once and run this opt-in test for a ready provider:

```sh
npm run build
node scripts/web-acceptance.mjs --provider chatgpt-web
```

Replace the provider with `gemini-web`, `deepseek-web` or `claude-web`. Each invocation sends **two real synthetic requests**, consumes the website's allowance, and saves evidence under `.giviloop/diagnostics/web-acceptance/`. It never sends this repository's code or executes code returned by a model.

The first request reviews a Git diff across inventory reservation, tenant cache and pagination. There are two deliberate regressions: partial stock deductions after a failed reservation and cache values shared across tenants. Pagination and expiry behavior are correct controls. The second request reviews the complete, corrected files in a new conversation. Eighteen independently authored assertions reproduce four failures before the fixes and all pass after the fixes. The harness also checks that sources remain unchanged and that MCP can read the completed, saved responses.

**Exit code zero confirms delivery and fixture assertions, not review accuracy.** Read `buggy-response.md`: both regressions should be identified, with concrete reproductions and minimal fixes, without inventing bugs in pagination/expiry. Read `fixed-response.md`: it should contain `NO_CONFIRMED_FINDINGS`, with no contradictory confirmed finding. Confirm `results.json` has two completed phases and `sourceUnchanged: true`. On failure inspect `failure.json` and, when available, `failure-browser-status.json`; an uncertain send must not be blindly retried.

In the first live pass on 22 September, Gemini identified both regressions (24.6 s) and accepted the corrected version (31.3 s), but omitted the requested concrete reproduction tests. ChatGPT identified the tenant bug, flagged stock mutation as conditional (32.9 s), then accepted the corrected version (35.7 s). Inspection showed Git's limited context had omitted the unchanged inventory contract. The repeatable harness now explicitly includes all declared contracts in the task goal. This is a practical review requirement: include relevant invariants in `--goal`/`taskGoal`, or use `ask --file`/`attachedFiles` for full selected files. Diff-only context does not guarantee a complete behavioral specification.

With explicit contracts, the repeated ChatGPT run confirmed both regressions with reproduction inputs, expected/actual behavior, minimal fixes and regression cases (28.4 s). Its fresh review of the corrected code found no confirmed bug (40.0 s). Across these six real requests, responses were saved/read successfully, sources remained unchanged, no verification challenge appeared, and no false confirmed finding was observed in the negative controls. This does not guarantee that challenges will never recur. ChatGPT used the existing signed-in session; Gemini used anonymous access; model identity was not selected or certified.

## Free-account setup and readiness

ChatGPT already completed signed-in and anonymous runs in this environment. Gemini completed anonymous runs; a personal Google account is optional for testing its signed-in path. DeepSeek and Claude redirected anonymous sessions to login, so those paths require the account holder to sign in before real generation can be validated.

For DeepSeek use the [web chat](https://chat.deepseek.com/), not its API platform. For Claude choose [Free](https://claude.com/pricing). No paid plan, API key or payment card is needed for this acceptance procedure; stop if an upgrade is requested. Free-site quotas still apply.

Work with one provider at a time:

```sh
npm run givi -- browser login --provider deepseek-web
```

Create/sign into the chat account in that dedicated window. Complete any human verification yourself, wait until the composer is visible, then quit that Chrome instance normally with **⌘Q** on macOS. Closing only its tab can leave the profile busy. If the dedicated login window is already open, use it instead of launching another instance. Next:

```sh
npm run givi -- browser check --provider deepseek-web
node scripts/web-acceptance.mjs --provider deepseek-web
```

Repeat with `claude-web`. A check with `ready: true` and `submitted: false` only proves the composer is accessible; the real two-phase test and manual response assessment above are still required. If a verification loop occurs, stop and report the status instead of repeatedly clicking or relaunching. Use `--background`, not `--headless`, for normal reviews; a short visible startup/setup window can occur.

**Readiness:** ChatGPT and anonymous Gemini have evidence for a limited pilot. DeepSeek/Claude remain experimental pending authenticated live generation and response validation. Passing these small cases is not a general model-quality benchmark or validation of long reasoning, specific subscription models, all locales or quota recovery. A stable multi-provider claim requires those remaining paths to be exercised and any observed failures corrected.

## Provider conditions

Technical availability does not establish authorization. DeepSeek §3.5(3) addresses automated copying of service content; Anthropic §3.7 restricts automated access without explicit permission or API access. Google terms and Gemini-specific conditions also apply; this implementation does not assert an automation exemption. See [DeepSeek terms](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html), [Anthropic terms](https://www.anthropic.com/legal/consumer-terms), [Google terms](https://policies.google.com/terms) and [costs/access](costs-and-access.md).

To repeat a real MCP check after an account is ready (sends a synthetic review):

```sh
node scripts/live-e2e.mjs --web --provider deepseek-web --output .giviloop/diagnostics/deepseek-live
```

Use an isolated `--browser-profile PATH` to test anonymous access without clearing a saved login. Do not rerun automatically after an uncertain send.
