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
  Windows 11/ARM, Wayland and live provider accounts on those systems have not
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

## Reproduce from a source checkout

The normal package check installs the actual tarball into a temporary consumer,
then exercises that installation. Its browser fixtures do not contact providers:

```sh
npm ci
npm run build
npm test
npm run test:package -- --browser
```

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
