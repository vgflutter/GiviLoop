# Double Check demo

The [README video](https://github.com/vgflutter/GiviLoop/releases/download/v0.3.1/giviloop-double-check.mp4) records actual commands and output in a documentation-only terminal view. It is not a new GiviLoop interface or a simulated provider response. The desktop, account controls and private conversations are not recorded.

The sequence shows:

1. The public `sum.ts` example, whose empty-array contract is deliberately broken.
2. A real `givi ask` through an already authenticated ChatGPT background session, with the actual waiting time shown.
3. The saved response read through `givi_read_external_review`, in `analyze-only` mode. The displayed answer is labeled as an excerpt.
4. A separate `verify.mjs` script reproducing the bug and checking four cases against a candidate correction in memory. This script is part of the example, not a built-in GiviLoop verification engine.

The video has no time compression. Headless Chrome renders only the recording's terminal view; the actual ChatGPT review uses native Chrome in background mode. Website token consumption and the exact underlying web model are unknown. Browser integration remains subject to the [access conditions](costs-and-access.md).

## Reproduce

Use a checkout with `npm ci` and `npm run build`, Google Chrome, and `ffmpeg` on `PATH`. Install Playwright's recording binary with `npx playwright install ffmpeg`. Authenticate the dedicated profile with `npm run givi -- browser login`, then close its window.

```sh
node scripts/record-demo.mjs
```

This explicitly sends the public example to ChatGPT. It creates a temporary example repository and records only its commands and output. The script checks that the saved response comes back through MCP, runs the independent example verification and confirms that source files are unchanged. If the provider fails, the recording is not reported as successful.

Outputs are stored in `.giviloop/diagnostics/readme-refresh/`: MP4, WebM, preview image, run metadata, response and verification output. Inspect the recording before sharing it. The original source fixture remains deliberately buggy.

For the independent example alone:

```sh
node examples/double-check/verify.mjs
```

The previous [IDE recording](https://github.com/user-attachments/assets/6d294d9f-8ac4-4f4a-bbc7-fb0638b7f297) and [console recording](https://github.com/user-attachments/assets/53948c6a-f53c-491f-9759-bca404b0c92e) remain available as historical demos.
