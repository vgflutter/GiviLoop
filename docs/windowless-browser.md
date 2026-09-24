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
- Linux still needs a graphical session. **Windows and Linux VM validation is
  pending.** Using cross-platform Chrome APIs is not evidence that those systems
  have already passed desktop-visibility or provider checks.

`--headless` remains a separate diagnostic mode. Earlier live ChatGPT checks in
that mode received HTTP 403/challenges. The results below use ordinary Chrome
without `--headless` and do not promise that every account or future request
will be accepted.

## Recorded macOS results — 24 September 2026

| Check | Result |
| --- | --- |
| Ordinary Chrome + offscreen bootstrap | 10 full launch/close cycles on the same temporary profile passed |
| Synthetic persistence and interaction | HttpOnly cookie, localStorage, entered text, exactly one send and asynchronous response passed across restarts |
| Startup visibility observation | 378 samples, 10 owned browser processes; 0 visible windows, 0 foreground samples, 0 enumeration failures |
| Largest startup-trial sampling gap | About 167 ms |
| Product transport regression | Concurrent profiles, three restart cycles, additional hidden pages, preserved cookies, explicit refusal to show a hidden page and restored Playwright environment passed |
| MCP behavior regression | Two separate requests reuse one owned browser; automatic-review deduplication and a windowless submission check passed |
| Installed-package checks | 226 unit/integration tests and 53 browser tests passed; dependency audit reported 0 vulnerabilities |
| Real ChatGPT access check | Ready, anonymous, no prompt submitted, no verification requested |
| Real ChatGPT MCP review: buggy fixture | Completed; correctly identified broken reservation atomicity and tenant cache isolation |
| Real ChatGPT MCP review: corrected fixture | Completed; `NO_CONFIRMED_FINDINGS`, consistent with all 18 independent contract assertions |
| Real-review desktop observation | 1,202 samples, 1 reused browser process; 0 visible windows, 0 foreground samples, 0 enumeration failures |
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
  --test-name-pattern='background pages|automatic MCP review uses windowless|saved defaults and MCP reuse' \
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

## Windows and Linux VM follow-up

In each VM, install Node, Git, Chrome and the `zip` utility required by the
existing archive fixtures. Use a dedicated profile inside that VM, not a copy of
an active macOS profile. Run the unit/package/browser checks above, then check
provider access without sending:

```sh
node dist/cli.js browser check --provider chatgpt-web
```

Only after that succeeds, run the explicit synthetic live acceptance. The macOS
Swift observer cannot measure another OS. Record native window/focus observations
on the VM desktop alongside CDP assertions, OS/Chrome versions, repeat launches,
profile persistence and clean shutdown before claiming Windows/Linux invisibility.

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
