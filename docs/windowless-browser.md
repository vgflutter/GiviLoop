# Windowless background reviews

Available in the current source checkout; not yet published as a tagged release.

Automatic web reviews now use a hidden top-level page in ordinary Google Chrome.
GiviLoop loads its bundled offscreen extension into the dedicated browser profile
through DevTools, then creates the review page without an associated native
browser window. CLI and MCP keep the existing `--background` / `background: true`
interface and saved provider/profile preferences.

The website still runs in a full browser. This does not remove the provider's
login, verification or usage limits. Initial setup and uploads retain the
explicit `open` / `resume --foreground` workflow. `WINDOWLESS_UNAVAILABLE` stops
instead of opening a visible or minimized fallback.

## Requirements and scope

- A recent ordinary Google Chrome installation. Tested: **153.0.8010.53** on
  **macOS 27.0 arm64**, with Node 22.21.1 and Playwright 1.61.1.
- The bundled `browser-extension/` files must be present; the installable package
  includes them. No separate Web Store or manual unpacked-extension install is
  needed. Chrome policies can restrict this developer capability.
- Background Chrome uses `--no-startup-window` and
  `--enable-unsafe-extension-debugging` to enable the documented experimental
  `Extensions.loadUnpacked` command on its temporary loopback DevTools endpoint.
  This applies to the owned GiviLoop process and dedicated profile. The extension
  has only `offscreen` permission, with no host permissions or content scripts.
- Chrome's sandbox and native credential store remain enabled. Existing dedicated
  profiles are reused; they are not copied, reset or converted to a different
  browser engine.
- Linux still needs a graphical session. Windows Server 2025 x64 and Ubuntu
  x64 with X11/Openbox passed automated desktop checks in GitHub-hosted VMs.
  Windows 11/ARM, Wayland and authenticated provider sessions on those systems have not
  been validated by those checks.

`--headless` remains a separate diagnostic mode. Earlier live ChatGPT checks in
that mode received HTTP 403/challenges. The results below use ordinary Chrome
without `--headless` and do not promise that every account or future request
will be accepted.

## Recorded macOS results — 24 September 2026

| Check | Result |
| --- | --- |
| Ordinary Chrome + offscreen bootstrap | 10 full launch/close cycles on the same temporary profile passed |
| Synthetic persistence and interaction | HttpOnly cookie, localStorage, entered text, exactly one send and asynchronous response passed across restarts |
| Startup visibility observation | 378 samples, 10 owned browser processes; 0 visible windows, 0 enumeration failures; focus measurement superseded below |
| Largest startup-trial sampling gap | About 167 ms |
| Product transport regression | Concurrent profiles, three restart cycles, additional hidden pages, preserved cookies, explicit refusal to show a hidden page and restored Playwright environment passed |
| MCP behavior regression | Two separate requests reuse one owned browser; automatic-review deduplication and a windowless submission check passed |
| Installed-package checks | 226 unit/integration tests and 53 browser tests passed; dependency audit reported 0 vulnerabilities |
| Real ChatGPT access check | Ready, anonymous, no prompt submitted, no verification requested |
| Real ChatGPT MCP review: buggy fixture | Completed; correctly identified broken reservation atomicity and tenant cache isolation |
| Real ChatGPT MCP review: corrected fixture | Completed; `NO_CONFIRMED_FINDINGS`, consistent with all 18 independent contract assertions |
| Real-review desktop observation | 1,202 samples, 1 reused browser process; 0 visible windows, 0 enumeration failures; focus measurement superseded below |
| Largest live-trial sampling gap | About 124 ms |

The live reviews sent only the public synthetic examples in
[`scripts/web-acceptance.mjs`](../scripts/web-acceptance.mjs), never this repository
or existing account conversations. The source files remained unchanged. The
second review ran in a separate conversation in the same retained MCP browser.
Both completed without a verification request, and the browser closed on MCP
disconnect. These were **anonymous ChatGPT** results; authenticated windowless
reviews and the other live providers remain to be checked separately.

The observer samples windows owned by the browser PIDs created by the test. It
does not record titles, screenshots or page contents. The live run observed up
to four non-visible native window objects belonging to Chrome; the review page
itself had no associated browser window. Zero visible samples cannot exclude a
flash between samples or a dialog belonging to another process. Dock/taskbar
icons, notifications and every fullscreen/Spaces arrangement were not measured.

Raw trial evidence is kept locally under `.giviloop/windowless-poc/` and
`.giviloop/diagnostics/`; these directories are not published. Historical
minimized-browser provider results are documented separately in
[web-providers.md](web-providers.md).

## Cross-platform validation — 25 September 2026 (Europe/Rome)

The first Windows/Linux runs exposed two real transport problems: hidden targets
did not schedule animation frames for Playwright's click checks, and after a
cross-site navigation CDP keyboard/mouse commands could return successfully
without delivering input. Focus emulation, lifecycle changes and screencasting
did not fix them. The shipped path now uses Chrome's DOM editing command,
verifies the complete composer text, and activates checked controls through the
DOM. It does not forge event trust, change the user agent, disable Chrome's
sandbox, capture the page or open a visible fallback. Unsupported editors stop
for an explicit foreground resume. This remains website automation: a future
provider UI can require another adapter change.

The [complete validation run](https://github.com/vgflutter/GiviLoop/actions/runs/36069542705)
passed all nine unit-test jobs (Windows/macOS/Linux × Node 20/22/24), plus the
installed-package and desktop checks in native Windows and Linux VMs. Its
artifacts contain the full observer reports and TAP output; browser cases use
synthetic provider pages with navigation intercepted locally, not live accounts.

| Installed package | Unit/integration passed | Browser passed | Skipped (unit / browser) | Audit vulnerabilities |
| --- | --- | --- | --- | --- |
| Windows Server 2025 x64 | 214 | 61 | 12 / 1 | 0 |
| Ubuntu x64 | 226 | 62 | 0 / 0 | 0 |

The Windows skips cover POSIX shell stubs, the POSIX Chrome profile-lock fixture
and process-signal semantics that Windows does not implement. Native Chrome
startup, concurrent profiles and MCP disconnect/profile release are exercised
by the real-browser tests on both systems.

| Environment | Chrome | Background browser processes | Visible / foreground samples | Largest sampling gap |
| --- | --- | --- | --- | --- |
| Windows Server 2025 x64, Node 22.23.2 | 154.0.8037.58 | 17 | 0 / 0 | 422 ms |
| Ubuntu x64, X11/Openbox, Node 22.23.2 | 154.0.8037.57 | 17 | 0 / 0 | 53 ms |

Both observers detected a visible **and foreground** Chrome window in a separate
positive control, observed every launched browser PID, and reported zero
enumeration failures. The negative cases covered all four provider adapters,
complete request text (including blank lines, tabs and HTML), exactly one send,
asynchronous responses, model selection/fallback, MCP reuse/deduplication,
concurrent profiles, three restart cycles, persistent cookies, and refusal to
submit altered/covered input. Background observation collected 4,100 samples
on Windows and 1,965 on Linux.
They do not establish invisibility on every desktop, nor exclude shorter flashes
between samples or windows owned by another process.

The macOS observer now services its run loop so `NSWorkspace` refreshes foreground
application information. A visible/focus positive control passed after this fix;
the earlier uncalibrated focus counts above should not be used as evidence.
The corrected observer then measured another two real anonymous ChatGPT reviews:
814 samples, one reused browser process, zero visible windows, zero foreground
samples, zero enumeration failures, and a maximum gap of about 107 ms. Both
responses completed; the buggy fixture's two defects were identified and the
corrected fixture returned `NO_CONFIRMED_FINDINGS`, consistent with all 18
independent contract assertions. No project source was sent.

## Real ChatGPT on Windows and Linux — 25 September 2026 (Europe/Rome)

The [opt-in live run](https://github.com/vgflutter/GiviLoop/actions/runs/36071247050)
completed both public synthetic reviews on each OS using fresh profiles and
ordinary Chrome. Each run calibrated its observer with a deliberately visible,
foreground Chrome window before launching the windowless review browser.

| Environment | Completed real reviews | Background samples | Visible / foreground samples | Largest sampling gap |
| --- | --- | --- | --- | --- |
| Windows Server 2025 x64, Chrome 154.0.8037.58 | 2 | 1,770 | 0 / 0 | 219 ms |
| Ubuntu X11 x64, Chrome 154.0.8037.57 | 2 | 1,353 | 0 / 0 | 51 ms |

Each pair reused one owned browser process, sent once per review, preserved the
synthetic source files and completed without an interactive verification request.
Every launched PID was observed, with zero enumeration failures. Responses on
both systems identified the introduced reservation-atomicity and tenant-isolation
defects; both corrected-fixture responses returned `NO_CONFIRMED_FINDINGS`,
consistent with the 18 independent contract assertions. The Windows buggy review
also included a hypothetical warning about a future change; pipeline success
does not mean every sentence of a model's review is a confirmed finding.

These are anonymous ChatGPT results, not authenticated-account or other-provider
validation. The sampling limits described above still apply. The artifacts retain
responses, status files, contract-check results and desktop counts; they contain
only these synthetic trials, not user profiles or credentials.

A separate local Ubuntu 24.04 environment under OrbStack on the Apple Silicon
Mac also passed the intercepted desktop suite (17 observed Chrome processes)
and two real anonymous ChatGPT reviews. This used x86-64 translation, Node
22.23.2, Chrome 154.0.8037.57 and X11/Openbox; it is additional evidence, not a
replacement for the native x64 hosted VMs. The live run recorded 1,439 background
samples, zero visible/foreground samples, zero enumeration failures and a maximum
gap of about 101 ms. The observer's visible/focus positive control passed. Both
responses matched the same buggy/fixed contract checks. Evidence remains local
under `.giviloop/diagnostics/local-linux-live/`.

A [later live repetition](https://github.com/vgflutter/GiviLoop/actions/runs/36073722201)
did not complete on either hosted OS. Windows stopped during composer validation
with `BROWSER_INTERACTION_REQUIRED`, `outcome: needs-attention` and
`submitted: false`. The status does not distinguish an unsupported editor from
an input overlay or a text mismatch. Linux recorded `submitted: true`, then
`RESPONSE_TIMEOUT` after its 180-second response wait; the prompt was not retried.
Neither run observed a visible window or foreground activation, and neither
reported interactive verification. These attempts are not counted as completed
reviews. Successful live trials demonstrate feasibility, not guaranteed
unattended completion on every subsequent website session. Inspect the retained
status before any explicit retry; a timeout does not mean the prompt was unsent.

Follow-up stress testing also reproduced a separate Windows discovery race:
Chrome could delete a candidate before Playwright removed it from its page list,
causing `Target.attachToTarget: No target with given id found`. Discovery now
ignores only a closed/deleted candidate before its identity is matched. Errors
on the matched review target still stop. A real-browser regression closes a
candidate between enumeration and attachment; it fails against the previous
implementation and passes with the fix. The restart regression now creates and
closes 100 additional hidden pages across ten concurrent-profile restart cycles.

The [final regression run](https://github.com/vgflutter/GiviLoop/actions/runs/36073549023)
passed all nine OS/Node unit jobs and both installed-package/desktop jobs with
the fix: Windows passed 214 unit and 62 browser tests (12/1 POSIX-specific skips),
and Linux passed 226 unit and 63 browser tests without skips. Both audits reported
zero vulnerabilities. Each desktop observer saw all 32 launched background Chrome
processes and zero visible/foreground samples; maximum sampling gaps were 172 ms
on Windows and 50 ms on Linux. The live repetitions above are reported separately
and are not silently treated as passed by this synthetic regression suite.

## Follow-up: editor correction and timeout diagnosis

The initial failed repetitions lacked page evidence, so their exact causes cannot
be reconstructed retrospectively. Follow-up tests now capture page state from
fresh anonymous synthetic-test profiles before closing Chrome. They reproduced
two composer representations that `innerText` did not faithfully serialize:

- An editor-only `ProseMirror-trailingBreak` made a 6,075-character request appear
  to contain 6,076 characters. This is a cursor placeholder, not request content.
- Hydration produced 204 paragraphs containing the same 6,075 request characters,
  while rendered paragraph spacing made `innerText` report 6,331 characters.

The comparison now decodes the observed plain-text paragraph/line-break shapes,
including flat editable fields. It preserves indentation, tabs, literal HTML and
real trailing newlines; it does not use `trim()` to hide differences. Regression
cases reject inserted/missing lines, changed indentation and rewritten code.
The browser waits for document loading, then verifies the complete text again
immediately before the single send action. A delayed editor rewrite must stop
before submission. ProseMirror's own [cursor-placeholder implementation](https://github.com/ProseMirror/prosemirror-view/blob/master/src/viewdesc.ts)
explains why this rendering detail is not part of its document.

After this correction, the previously failing hosted Linux environment completed
both real reviews in [one run](https://github.com/vgflutter/GiviLoop/actions/runs/36108567376)
and again in the **Linux job** of [the repetition](https://github.com/vgflutter/GiviLoop/actions/runs/36108837721).
The first pair completed in 14.2 and 13.4 seconds. Its calibrated observer recorded
1,088 background samples, one reused Chrome process, zero visible/foreground
samples and zero enumeration failures, with a maximum sampling gap of 58 ms.
The buggy response identified both seeded defects; the fixed response returned
`NO_CONFIRMED_FINDINGS`. The Windows job of the repetition timed out and is not
counted as a completed live check.

Further [diagnostic attempts on both hosted systems](https://github.com/vgflutter/GiviLoop/actions/runs/36109471263)
returned HTTP 403 for website JavaScript assets and displayed **“An error occurred
during verification, please try again.”** No assistant answer appeared. GiviLoop
now recognizes that explicit website error as `ACCESS_CHALLENGE` instead of
waiting 180 seconds and reporting `RESPONSE_TIMEOUT`. Tests cover the message
before and after an attempted send, plus quoted copies in the conversation that
must not trigger a false challenge. No verification or resend is automated.
The retained submission flag must still be inspected: clicking Send does not
prove that the service accepted or answered the request.

These results distinguish a corrected editor bug from website access failures.
They do not promise that a new anonymous cloud-runner session will always be
accepted by the provider. Original failures and unsuccessful repetitions remain
in the evidence rather than being relabeled as successes.

A separate rendering regression was then reproduced on a fully local page:
hidden Chrome reported `visibilityState=visible`, ran ordinary timers, but
delivered zero animation callbacks. Focus emulation, disabled background
throttling and screenshot capture did not restore those callbacks. A synthetic
assistant-response regression now updates its DOM in `requestAnimationFrame`
and verifies completion with the correction. This explains why a successful send alone was insufficient
to validate the complete workflow.

Windowless ChatGPT reviews now install a narrowly scoped scheduling fallback
before navigation. The native callback wins when delivered; otherwise the
pending callback is delivered after 100 ms with a monotonic timestamp. A cancelled
callback stays cancelled and a callback is never delivered twice. This changes
animation scheduling in the configured top-level chat document. It does not run
inside child frames or on authentication origins, alter event trust or user
agent, accept a challenge, or read responses through a private API. Product
responses are still obtained from the website DOM. Healthy retained pages install
the compatibility code once per configured origin.

The [isolated rendering experiment](https://github.com/vgflutter/GiviLoop/actions/runs/36111695169)
completed two real reviews on each OS, including the dynamic editor/streaming UI.
Both calibrated observers saw one reused Chrome process and zero visible or
foreground samples. Linux recorded 1,432 samples (maximum gap 59 ms); Windows
recorded 2,168 (156 ms). This experiment preceded integration into the product;
its diagnostic-only switch has been removed after the integration. The browser
regressions cover missing/native callbacks, cancellation, origin/frame boundaries
and a response requiring an animation callback.

## Reproduce from a source checkout

The normal package check installs the actual tarball into a temporary consumer,
then exercises that installation. Its browser fixtures do not contact providers:

```sh
npm ci
npm run build
npm test
npm run test:package -- --browser
```

For slower emulated VMs, `npm run test:package -- --browser --slow-vm` doubles
only the overall unit/browser suite budgets (to eight and twenty minutes).
Individual test deadlines, assertions and provider wait limits are unchanged.
The package report records this option; native CI uses the normal budgets.

The full browser suite deliberately opens windows for explicit foreground/login
handoff checks. To run just the windowless regressions:

```sh
node --test --test-concurrency=1 \
  --test-name-pattern='--background|windowless input|background pages|automatic MCP review uses windowless|saved defaults and MCP reuse' \
  test/browser/roundtrip.test.mjs
```

For desktop observation on macOS, compile the optional observer:

```sh
xcrun swiftc -module-cache-path /private/tmp/giviloop-windowless-swift-cache \
  scripts/poc-windowless/observe-macos.swift \
  -o /private/tmp/giviloop-windowless-observer
node scripts/poc-windowless/run.mjs --chrome installed --bootstrap \
  --bootstrap-method cdp --cycles 10 \
  --observer /private/tmp/giviloop-windowless-observer \
  --output .giviloop/windowless-poc/installed-offscreen-cdp.json
```

The isolated PoC checks the startup mechanism; the product regressions above
exercise the shipped transport and its bundled extension. This opt-in live
command sends two synthetic reviews and measures the production MCP workflow:

```sh
node scripts/windowless-live.mjs --provider chatgpt-web \
  --observer /private/tmp/giviloop-windowless-observer
```

It accepts `--browser-profile PATH` for another dedicated profile. A failed or
uncertain delivery retains its status; inspect that evidence before another
submission. The script does not log in, solve challenges or switch providers.

## Reproduce Windows and Linux checks

In each VM, install Node, Git, Chrome and the `zip` utility required by the
existing archive fixtures. Use a dedicated profile inside that VM, not a copy of
an active macOS profile. Run the unit/package/browser checks above, then check
provider access without sending:

```sh
node dist/cli.js browser check --provider chatgpt-web
```

Only after that succeeds, run the explicit synthetic live acceptance. The macOS
Swift observer cannot measure another OS. The portable desktop runner selects
Win32 enumeration on Windows, X11 on Linux, or the Swift observer on macOS:

```sh
node scripts/windowless-desktop.mjs
```

Python is required on Windows. Linux additionally needs `python3-xlib`, a running
X11 display and a window manager; the CI workflow provisions Xvfb and Openbox.
macOS needs the Swift compiler. The command deliberately opens **one** positive
control window, then observes the production background regressions. Reports go
to `.giviloop/diagnostics/windowless-desktop.json` and `desktop-*.log`. A separate
manual **Windowless desktop** workflow runs this check without the package suite.
The normal **Tests** workflow also exercises Node 20/22/24 on all three OS families
and keeps per-OS package reports, passing/skipped counts, TAP logs and audit output.

To explicitly send the two public synthetic reviews with a fresh temporary
profile and native observation on any of the three OS families:

```sh
node scripts/windowless-desktop.mjs --live-provider chatgpt-web
```

This uses the installed ordinary Chrome, never imports an existing profile, and
removes the temporary profile when finished. Login/verification requirements
fail the check and retain delivery evidence instead of retrying the submission.
A failed positive-control calibration stops before any live prompt is sent.
The report is `.giviloop/diagnostics/windowless-live-chatgpt-web.json`, alongside
the `web-acceptance/` responses and `desktop-*.log` files. Test one workload at a
time because the desktop log filenames are shared.

The portable live runner enables synthetic page diagnostics: editor text/markup,
navigation origins, HTTP status codes and structural response indicators. It
does not retain cookies, headers, URL query strings or raw network bodies. The
underlying `web-acceptance.mjs --diagnostics --browser-profile PATH` refuses a
nonempty profile; ordinary acceptance runs without `--diagnostics` do not enable
this instrumentation. Failure evidence includes the synthetic request for an
exact comparison with the editor.

The same explicit opt-in runs on both hosted VMs through the manual workflow:

```sh
gh workflow run desktop-probe.yml -f live-provider=chatgpt-web
```

Use `-f runner=ubuntu-latest` or `-f runner=windows-latest` for one system; the
default is `both`. Desktop coverage counts individual launch records, with unique
PID counts reported separately, so PID recycling does not merge two launches.

Its default `live-provider=none` runs only the intercepted fixture tests. Normal
push/PR tests never opt into real provider submissions.

## Implementation dependencies

The offscreen document provides Chrome's initial frame target and a local DOM
parser. The provider page is a separate top-level target, not an embedded iframe.
The creator CDP session must remain attached for its hidden pages to survive.
Additional pages requested on that context also use hidden targets; they never
fall back to `context.newPage()` creating a visible tab.

Playwright currently exposes these targets through its internal
`PW_CHROMIUM_ATTACH_TO_OTHER` opt-in. GiviLoop pins Playwright 1.61.1 and scopes
that environment setting to attachment, preserving its prior value across
concurrent launches. Updating Playwright requires rerunning the hidden-page
regressions. Chrome's extension-loading and hidden-target APIs are experimental.

Primary references: [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen),
[CDP Extensions](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/),
[CDP Target.createTarget](https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-createTarget).
