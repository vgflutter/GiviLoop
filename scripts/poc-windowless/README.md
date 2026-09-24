# Browser visibility experiments

Development-only probes for four alternatives to GiviLoop's minimized Chrome
transport. These scripts are not imported by production code and are excluded
from the npm package. See [the findings](FINDINGS.md) for the comparison and
the distinction between invisible windows and provider access.

The offscreen approach has since been integrated into the product and tested in
ordinary Chrome. See [current product validation](../../docs/windowless-browser.md).
The other engines remain research probes.

Each successful run checks a synthetic HTTPS page, a persistent HttpOnly cookie,
localStorage across restarts, the inserted text, exactly one synthetic send, an
asynchronous response and cooperative process shutdown. No provider account,
prompt, repository contents or existing browser profile is used. Page requests
outside the fixture origin are aborted; this is not a network sandbox for the
browser's own background services.

## Prerequisites and observation

The recorded environment was macOS 27.0 arm64, Node 22.21.1 and Playwright 1.61.1.
Run `npm run build` first: executable discovery comes from the existing compiled
GiviLoop module. The extension probes use Playwright's Chrome for Testing binary.
If it is missing, install it with `npx playwright install chromium`.

The optional macOS observer is read-only. It records window counts and foreground
status for the browser PIDs created by the probe, without titles or screenshots:

```sh
xcrun swiftc -module-cache-path /private/tmp/giviloop-windowless-swift-cache \
  scripts/poc-windowless/observe-macos.swift \
  -o /private/tmp/giviloop-windowless-observer
```

Omit `--observer` on another OS. Such a run checks browser behavior but does **not**
measure desktop visibility. The observer attempts 20 ms intervals; actual gaps
are recorded. It cannot rule out flashes between samples or dialogs owned by
other processes. Dock/taskbar icons are not measured. Windows and Linux have
not been run. Chrome and Electron still
need a graphical session on Linux even when their windows are hidden.

## 1. Chrome offscreen extension and hidden target

```sh
node scripts/poc-windowless/run.mjs --chrome testing --bootstrap --cycles 10 \
  --observer /private/tmp/giviloop-windowless-observer \
  --output .giviloop/windowless-poc/offscreen-dom-parser.json
```

`bootstrap-extension` creates a local offscreen document using `DOM_PARSER` and
actually verifies its DOM parsing via runtime messages. Its only permission is
`offscreen`. This supplies a frame target before the harness creates a separate
hidden top-level web page via CDP. It does not embed a provider in an iframe.
There is no `--offscreen-document-testing` flag in this version.

The target's owner CDP session stays attached, an explicit viewport enables
pointer interaction, and `Browser.getWindowForTarget` must report no window.
Playwright currently needs the internal `PW_CHROMIUM_ATTACH_TO_OTHER` switch to
expose this kind of target; that is an experimental compatibility dependency.

Control runs without the extension:

```sh
node scripts/poc-windowless/run.mjs --chrome testing --cycles 3 \
  --observer /private/tmp/giviloop-windowless-observer \
  --output .giviloop/windowless-poc/testing-baseline.json
node scripts/poc-windowless/run.mjs --chrome installed --cycles 3 \
  --observer /private/tmp/giviloop-windowless-observer \
  --output .giviloop/windowless-poc/installed-baseline.json
```

Both controls failed on the second launch in the recorded trials. `--chrome
installed` uses normal GiviLoop executable discovery, including
`GIVILOOP_CHROME_PATH`. Regular branded Chrome removed command-line extension
loading. The later trial uses the supported experimental DevTools command:

```sh
node scripts/poc-windowless/run.mjs --chrome installed --bootstrap \
  --bootstrap-method cdp --cycles 10 \
  --observer /private/tmp/giviloop-windowless-observer \
  --output .giviloop/windowless-poc/installed-offscreen-cdp.json
```

This adds `--enable-unsafe-extension-debugging` only to the owned temporary-profile
process and loads this local fixture extension via `Extensions.loadUnpacked`.
All ten ordinary-Chrome cycles passed on macOS. The default `--bootstrap-method
cli` remains limited to Chrome for Testing for comparison with the original trial.

## 2. Electron hidden window

Install the additional runtimes outside GiviLoop's dependencies. These are the
exact versions used in the recorded experiment; the commands below use macOS
temporary paths:

```sh
npm install --prefix /private/tmp/giviloop-browser-experiments \
  --no-audit --no-fund --save-exact \
  electron@44.4.5 carbonyl@0.0.2-next.bacf3db
node /private/tmp/giviloop-browser-experiments/node_modules/electron/install.js
node scripts/poc-windowless/compare.mjs --engine electron --cycles 10 \
  --runtime /private/tmp/giviloop-browser-experiments \
  --observer /private/tmp/giviloop-windowless-observer
```

Electron's installer downloads its official binary separately. On this machine
Node required `NODE_OPTIONS=--use-system-ca` to trust the configured system CAs;
TLS verification was retained. The helper strips an inherited
`ELECTRON_RUN_AS_NODE` only from its own Electron child environment.

`electron-main.cjs` owns one `BrowserWindow({ show: false })` in a temporary
persistent profile. Node integration is off; context isolation, renderer sandbox
and web security are enabled. Popups are denied for this fixture probe. A stdin
message flushes cookies/storage and requests application exit. CDP drives the
same fixture checks as the Chrome probe. This tests a hidden native window,
not the absence of a native window object.

## 3. Inactive tabs in an existing browser

```sh
node scripts/poc-windowless/tabs.mjs \
  --observer /private/tmp/giviloop-windowless-observer
```

Two isolated browser sessions run ten jobs each. A minimized setup window stands
in for a browser that the user already opened. **Setup itself can produce a
transient visible window**, which is included in the observer's statistics.
This experiment does not establish invisible startup from a closed browser.

The extension creates an `active: false` tab in an existing window, enters text
and clicks through `chrome.scripting`, then removes only that tab. The harness
navigates it to the intercepted fixture. Before closing each job it checks that
all previously selected tab IDs and the browser window ID set are unchanged.
Restored windows at the second startup are included in the comparison.

The extension is limited to the fixture origin. The prototype invokes its worker
through CDP; a production native-messaging bridge, its OS installers, job leases,
cancellation and handling of users closing/rearranging tabs are not implemented.
The ten jobs within each session share the same browser process. The user's real
browser is never attached to or modified.

## 4. Terminal browsers

```sh
node scripts/poc-windowless/compare.mjs --engine carbonyl --cycles 10 \
  --runtime /private/tmp/giviloop-browser-experiments \
  --observer /private/tmp/giviloop-windowless-observer
```

Carbonyl runs inside a Python standard-library pseudoterminal with its terminal
painting consumed, so no Terminal application window is opened. It does not print
the usual DevTools announcement: the harness discovers its endpoint on the
loopback port allocated for that child. `terminal-launch.py` is POSIX-specific;
it is not a native Windows implementation. The npm distribution tested here has
macOS and Linux binaries and reports Chromium 111. It is a feasibility sample,
not a suitable proposed default for authenticated provider traffic.

The Firefox prerequisite for Browsh was also attempted using the already
installed Playwright Firefox runtime:

```sh
node scripts/poc-windowless/compare.mjs --engine firefox --cycles 2
```

That runtime failed during headless startup on this Mac; no fixture checks ran.
The retained report records the original 180-second timeout; the script now caps
startup at 30 seconds. Browsh itself has **not** passed an end-to-end test. This
failure does not establish that Firefox or Browsh cannot work on another host.

## Evidence and validation

Raw run reports are written under `.giviloop/windowless-poc/` (gitignored).
`compare.mjs` accepts `--output PATH`; `run.mjs` also accepts it. Profiles are
temporary and removed after cleanup. A failed acceptance check exits with code 1.
There is no automatic switch to a visible window or a different browser mode.

[The recorded summary](results-2026-09-24.json) contains the final results and
observer statistics without temporary paths or browser content.

`npm test` passed 225/225 on 24 September 2026, after rerunning with permission
to listen on localhost (the restricted sandbox initially returned `EPERM`).
JavaScript/Python syntax checks passed and the Swift observer compiled. The
existing `test:browser` suite was not rerun: it deliberately opens visible
handoff windows and does not exercise these experimental transports. The
dedicated probes above supplied their own browser validation.
