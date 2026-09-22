# Browser and review troubleshooting

Run `givi doctor` first (from the source checkout: `npm run givi -- doctor`). It reports Chrome's path, the dedicated profile, a detected profile owner, and the previous shutdown state when the profile is closed. While it is open, the shutdown state is unknown; Chrome's active-session crash marker is not evidence that it has crashed. It does not open the website or inspect cookies, so authentication is reported as unknown.

## Initial login

```sh
givi browser login
# Complete login in the regular Chrome window, then close that dedicated browser.
givi send --repo /path/to/repo --mode auto --background
```

`browser login` opens a new, maximized window and uses LaunchServices on macOS to bring Chrome forward. It checks for an immediate launcher failure instead of reporting success after merely spawning a process. It opens regular Chrome with `~/.giviloop/browser-profiles/chatgpt`. It does not launch the automated browser. Google can reject login in a browser controlled by automation; retrying that login through Playwright is not a dependency fix. See [Google's browser guidance](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=en).

If using `--browser-profile /dedicated/path`, use the same path for `doctor`, `browser login`, and `send`. For MCP, the equivalent is `browserProfile`. Do not point this option at the profile you use for everyday browsing. GiviLoop does not migrate cookies from that profile.

Initial sign-in and any interactive account verification require the account holder. The anonymous composer, when offered by the site, can be used without logging in, but it does not validate access to subscription models or features.

If login succeeded in regular Chrome but disappeared during automation, update to 0.2.0-rc.1 or later. GiviLoop now uses Chrome's native credential store for both launches. The earlier Playwright testing defaults (`--use-mock-keychain` and `--password-store=basic`) could make the saved login cookies unreadable. The fix was checked against the authenticated profile and a synthetic persistent-cookie regression test. An HTTP 403 after this fix is an access denial, not evidence that you failed to log in; repeating the login does not resolve that response.

## A blank window or “Restore pages?” prompt

The restore prompt indicates a previous abnormal Chrome shutdown; it does not identify the underlying cause by itself. Chrome retains the `Crashed` preference through later clean exits when session recovery remains unacknowledged. Restoring or dismissing the prompt, or opening another window after startup, acknowledges it. This behavior is explicit in [Chromium's session handling](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/sessions/exit_type_service.cc). `doctor` reports the saved marker and the applicable recovery step; it does not rewrite Chrome preferences.

To clear an old marker, open the **dedicated** profile with `givi browser login`. Restore the old tabs if you need them; otherwise dismiss “Restore pages?” or open a new window (`Cmd+N` on macOS, `Ctrl+N` on Windows/Linux) after Chrome has started. Then quit that Chrome normally (`Cmd+Q` on macOS; Exit from Chrome's menu on Windows/Linux) and run `givi doctor` again. Chrome should now save `previousExit: "Normal"`. This preserves the login profile; simply closing a window with recovery still pending can leave the marker unchanged.

Completed `auto` runs request Chrome's cooperative shutdown and wait for the owned process to exit before returning. Avoid force-quitting it. If `Crashed` returns after recovery, investigate that new shutdown rather than repeatedly clearing the marker; check the run's `browser-status.json` for provider errors and the OS crash reports for a browser crash.

1. Close the dedicated GiviLoop Chrome window normally. Do not kill every Chrome process.
2. Run `givi doctor` again. Wait for `profileBusy: false` before sending.
3. Use `givi browser login` to check the website in that same regular profile. If the site remains unavailable there, diagnose the network or provider access before launching another automated run.
4. To test profile corruption, use a new **dedicated** path with `--browser-profile`. This leaves the original profile intact; sign in again if needed. Only back up or rename an old profile after its Chrome process has exited.

Do not remove `SingletonLock` while Chrome owns the profile, copy active profile databases, or delete your personal Chrome data. A crashed profile is never reset automatically by GiviLoop.

## Background versus headless

`--background --mode auto` runs normal Chrome and verifies that the window is minimized. A startup window can appear; ZIP uploads also temporarily show Chrome to initialize its attachment controls, then minimize it again before sending. It requires a desktop session capable of minimizing windows.

On Linux, a bare Xvfb display does not provide a window manager and can produce `BACKGROUND_UNAVAILABLE`. The browser/package CI uses Xvfb plus Openbox and waits for window management to become available before testing native background sessions. A desktop requirement is separate from the website's access restrictions.

`--headless --mode auto` does not create a visible window. **It is currently unusable for live ChatGPT reviews:** the release trial received HTTP 403, and the 22 September checks were challenged with both authenticated and anonymous profiles. No prompt was sent. Use `--background`. GiviLoop stops on the block; it does not silently switch modes, hide automation flags, retry rate limits, or bypass an account challenge.

Neither mode performs interactive login. They cannot be combined. `prefill` and `submit` require a visible window because they leave further work to the user.

## Human verification and repeated challenges

In 0.3.0-rc.2, visible/background sessions use native Chrome connected over a temporary loopback DevTools endpoint. This resolved the observed 403 with the existing authenticated profile in two real CLI/MCP reviews. If you are using an earlier build, update and run `givi browser check`. Headless still received a challenge in the same session. See the [measured comparison](chatgpt-403-resolution-2026-09-21.md).

```sh
givi browser check
givi browser check --verification-wait-ms 300000
```

`browser check` opens the dedicated profile and checks website access without preparing, filling or sending any review. Its JSON output distinguishes a readable login session, a usable composer, and a saved verification cookie. Cookie values and conversation text are never returned. A readable session or a future cookie expiry does not prove that the site accepts the browser.

In visible mode, both a review and this check wait up to three minutes for human verification. `--verification-wait-ms` / MCP `verificationWaitMs` changes this period, up to fifteen minutes; `0` disables the wait. A background review temporarily restores its window for the tap and minimizes it again after verification. The original request resumes only after an allowed document and composer appear on the expected provider origin. GiviLoop does not click verification controls itself. Headless cannot wait for a human and reports the challenge immediately.

Cloudflare identifies these responses with `cf-mitigated: challenge`. GiviLoop also recognizes a challenge in the page DOM. A third challenged document during the same wait stops with `ACCESS_CHALLENGE_LOOP`, rather than asking you to keep repeating the tap. There is no automatic reload or new request submission by GiviLoop during this wait.

The regular Chrome profile preserves both login and verification cookies, using the native credential store. Chrome's sandbox is enabled: GiviLoop no longer launches with Playwright's default `--no-sandbox`. On Linux, run Chrome as a normal user with a supported sandbox setup; an unsupported environment fails instead of silently disabling it.

A one-time tap cannot be promised. Cloudflare stores successful verification in `cf_clearance`, but the website controls subsequent acceptance and can require a new challenge. In the live trial, the cookie was present and readable yet the site challenged again; reinstalling GiviLoop or deleting the login was not an evidenced remedy. See [Cloudflare's challenge identification](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) and [challenge passage](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/challenge-passage/).

If the loop recurs, stop clicking. Check access with `givi browser login` in regular Chrome and preserve the original profile; the automated route remains unavailable until the provider accepts it. Local runtimes remain usable. Returning HTTP 200 in a test fixture, storing the cookie, or completing a login does not count as a successful live review.

## Error reference

| Code | Meaning and next step |
| --- | --- |
| `BROWSER_NOT_FOUND` | Install Google Chrome, or set `GIVILOOP_CHROME_PATH` to the Chrome executable. `npm ci` installs JavaScript dependencies, not system Chrome. |
| `BROWSER_PROFILE_BUSY` | Close the dedicated browser that owns this profile, or use a separate dedicated profile for another job. No prompt was sent. |
| `BROWSER_LAUNCH_FAILED` | Check the executable, permissions, and profile health with `doctor`. |
| `BACKGROUND_UNAVAILABLE` | The window could not be minimized. Use visible mode in that environment. No prompt was sent. |
| `NAVIGATION_FAILED` / `NETWORK_ERROR` | Navigation failed before submission, including its one allowed retry. Check connectivity and open the site with `browser login`. |
| `ACCESS_DENIED` / `ACCESS_CHALLENGE` | The provider denied access or requested verification. Stop and inspect the site in regular Chrome; there is no automatic bypass. |
| `ACCESS_CHALLENGE_LOOP` | The site repeatedly challenged the browser during the same wait. Stop repeating the tap; inspect access in regular Chrome. No prompt was sent. |
| `UNEXPECTED_ORIGIN` | The page left the configured provider origin. Context transfer stops before filling, uploading or sending. |
| `BROWSER_CANCELLED` | The caller cancelled the pending review. Its owned browser context is closed and its run lock released. Check `submitted` before explicitly retrying. |
| `LOGIN_REQUIRED` | The chat needs an authenticated session. Use `browser login`, then close it before sending again. |
| `PROVIDER_LIMIT` | The provider is limiting requests. Wait according to the site's guidance; GiviLoop does not retry automatically. |
| `CHAT_INPUT_UNAVAILABLE` / `SEND_UNAVAILABLE` | The expected composer or enabled send button did not appear. Inspect the UI and attachment state. No prompt was sent. |
| `MODEL_UNAVAILABLE` / `MODEL_SELECTION_UNCONFIRMED` | The exact requested model label was absent or selection could not be confirmed. With `--require-model`, sending stops. Without it, a warning explicitly reports fallback. |
| `ATTACHMENT_UNAVAILABLE` / `ATTACHMENT_UNCONFIRMED` | A file could not be attached or its presence was not confirmed. No prompt was sent. GiviLoop does not upload it again after an uncertain confirmation. |
| `SUBMISSION_UNCERTAIN` | The send click may have reached the provider. Inspect the conversation before retrying to avoid a duplicate request. |
| `RESPONSE_TIMEOUT` / `RESPONSE_INCOMPLETE` | Submission happened, but a completed answer could not be confirmed in time. Inspect the conversation; a previous saved answer is preserved. Increase `--max-wait-ms` for subsequent long tasks. |
| `BROWSER_CLOSED` / `BROWSER_OPERATION_FAILED` | The window closed or an unclassified browser operation failed. Inspect the recorded stage and submission state before retrying. |

## Reading the diagnostic state

Each browser run records `.giviloop/runs/<run-id>/browser-status.json` next to its response. In legacy layouts it is next to the configured response path. Useful fields are `phase`, `outcome`, `errorCode`, `submitted`, and the timestamps.

- `submitted: false`: this attempt did not click Send.
- `submitted: "unknown"`: the send action could not be confirmed; check the website before repeating it.
- `submitted: true`: the click completed. This is not a provider receipt or a guarantee of a completed answer.
- `outcome: "completed"`: the response was confirmed by the supported UI checks and saved atomically.

Responses are plain text extracted from the rendered answer. Complex tables or code formatting may need comparison with the website. External reviews remain untrusted advice and should be checked against the source and tests before edits are accepted.

GiviLoop preserves pending and active runs. Older completed, inactive runs are pruned when a new run is prepared. `--run-id ID` / MCP `runId` keeps a response associated with its original request.

## Reporting a reproducible issue

Include the GiviLoop version, OS, Node version, redacted command, error code, and relevant diagnostic fields. Remove private paths as needed. Do not share your browser profile, cookies, credentials, private source archives, or account screenshots containing sensitive information.

The [provider access note](accesso-provider.md) explains the separate contractual considerations. A successful browser test does not establish provider authorization.


## Local inference

For local runtimes use `givi doctor --provider NAME`, optionally with `--base-url`. Supported names are `ollama`, `dwarfstar`, `llama-cpp`, `lmstudio`, and `mlx`. Browser installation and login are irrelevant to these commands. See [Ollama](ollama.md), [DwarfStar](dwarfstar.md), and [the other local engines](local-engines.md) for their model/context requirements and errors.

Local run state is in `local-status.json`; token counts, model, timing and request/response hashes are in `local-usage.json`. On a storage failure, compare the recorded response hash with the saved response before associating usage with that text. A failed attempt does not establish a completed new review.

`REVIEW_RUN_BUSY` means another browser or local request owns the run's `review.lock`. Do not remove it while the recorded PID is running. Ctrl+C and MCP request cancellation release local inference locks. A force-killed process may leave a stale lock: confirm that its PID has exited, then remove only that run's lock. Pending, active and locked runs are preserved by retention.
