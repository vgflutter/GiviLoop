# Double Check demo — 0.5.0

The [74-second README video](https://github.com/vgflutter/GiviLoop/releases/download/v0.5.0/giviloop-double-check.mp4) shows real CLI commands and MCP results in a documentation-only terminal view. It does not record the desktop, account controls or private conversations. The view is a recording aid, not a new GiviLoop interface.

1. `givi setup --provider claude-web --non-interactive` checks prerequisites and generates an MCP entry. The dedicated Claude session was already signed in; this does not demonstrate a new account login.
2. A real background browser request reviews the public, deliberately buggy `sum.ts` example. The saved response is read back through MCP. This recorded request completed in about 16 seconds without an extra verification challenge; that is one observation, not a latency guarantee.
3. The separate example verification script reproduces `sum([])` throwing and checks four cases against an author-selected correction in memory. No model-generated code is executed.
4. MCP records the confirmed bug and a dismissed **author-supplied false-claim control** about negative numbers. The control is explicitly labeled and is **not attributed to Claude**. An independent assertion demonstrates the negative-number case works.
5. The script applies the already checked one-line correction only to the temporary demo copy. The saved assessment becomes stale. MCP prepares a targeted recheck linked to the parent finding with fresh source; it is **not sent** in this video.

No time compression is used. Headless Chrome renders only the recording view; the actual review uses native Chrome in background mode. The repository's original example remains unchanged. Website token usage and the exact underlying web model are unknown. Provider terms and quotas apply; this is not a benchmark or a measured total-token saving.

## Reproduce

Requires a checkout with `npm ci` and `npm run build`, Chrome, `ffmpeg` on PATH, and Playwright's recording binary (`npx playwright install ffmpeg`). Authenticate the dedicated profile with `npm run givi -- browser login --provider claude-web`, then quit it normally.

```sh
node scripts/record-demo.mjs
```

This explicitly sends only the public example to Claude. It checks the response transfer, independent assertions, persisted decisions, stale detection and prepared recheck. Failed provider calls/assertions stop the recording from being reported as successful.

Outputs in `.giviloop/diagnostics/adoption-demo/` include MP4, WebM, preview image, `demo-run.json`, saved response and independent verification output. The release includes the video and its provenance report. Inspect before sharing. The false-claim control is synthetic; it makes no claim about provider accuracy.

The previous [0.3.1 ChatGPT demo](https://github.com/vgflutter/GiviLoop/releases/download/v0.3.1/giviloop-double-check.mp4) remains available as a historical recording.
