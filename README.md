# GiviLoop

**Double-check your code. Save API tokens with your existing web chat.**

GiviLoop sends selected code or Git changes to a second reviewer and brings the answer back to your coding agent. Keep the request, review and execution status together in your repository.

CLI + MCP · Web chat + local models · Open source · MIT

- **Double Check:** have your agent verify another model's findings before changing code.
- **Save API tokens on the second review:** use your existing web chat instead of making another token-billed model API call. GiviLoop sends the selected context and brings back the answer.

**What “token savings” means:** if you would otherwise buy that review through an API, this avoids its separate API input/output token charges. The web chat still uses its plan's quotas, and your coding agent still uses tokens to prepare context and check the answer. **Total token savings are not measured.** [Costs and access](docs/costs-and-access.md).

## See it work

[![Watch a real Double Check run](https://raw.githubusercontent.com/vgflutter/GiviLoop/main/docs/media/double-check-preview.png)](https://github.com/vgflutter/GiviLoop/releases/download/v0.3.1/giviloop-double-check.mp4)

[Watch the demo (MP4)](https://github.com/vgflutter/GiviLoop/releases/download/v0.3.1/giviloop-double-check.mp4): a real CLI review, MCP handoff and an independent check of the proposed fix. Uses a deliberately buggy example and an already authenticated session. [Recording details](docs/demo.md).

## Try a first review

Requires Node.js 20+, Git and Google Chrome for the optional web integration.

```sh
git clone https://github.com/vgflutter/GiviLoop.git
cd GiviLoop
npm ci
npm run build
npm run givi -- browser login
# Sign in, then close the dedicated Chrome window.
npm run givi -- browser check

npm run givi -- ask --repo . --file examples/double-check/sum.ts \
  --question "Find a concrete bug, the smallest fix and regression tests." \
  --send chatgpt-web --mode auto --background
```

GiviLoop saves the answer and prints its path. The example's `sum([])` should return zero but throws; ask your agent to check the finding before applying the fix. Run `node examples/double-check/verify.mjs` to reproduce this example independently.

**Web access is experimental.** Background mode uses a minimized Chrome window; login or human verification can still be required. Headless remains blocked in the tested session. OpenAI's European terms prohibit automatic output extraction; technical success and MIT licensing do not establish permission. [Costs and access](docs/costs-and-access.md).

For manual web transfer, prepare without `--send`, then use `givi copy --open` and `givi ingest` around your own paste/send/copy actions. For automatic local reviews, use [Ollama](docs/ollama.md), [llama.cpp, LM Studio or MLX](docs/local-engines.md). [DwarfStar](docs/dwarfstar.md) is also available, with trained-model validation still pending.

## Use it from your coding agent

Add this stdio server to your MCP client's configuration:

```json
{
  "mcpServers": {
    "giviloop": {
      "command": "node",
      "args": ["/absolute/path/to/GiviLoop/dist/mcp-server.js"]
    }
  }
}
```

Then ask:

```text
Double-check my current Git changes with GiviLoop.
Use ChatGPT web in auto mode with background enabled.
Read the review in analyze-only mode. Verify each finding against the code
and tests; report confirmed, dismissed or unverified, with reasons.
Do not edit files.
```

The coding agent performs the verification. GiviLoop handles context and review transfer; it does not run tests or apply fixes itself. [Full Double Check recipe](docs/double-check.md).

## Install, learn, contribute

- [Latest release and installable package](https://github.com/vgflutter/GiviLoop/releases/latest) · [CLI/MCP reference](docs/usage.md)
- [Troubleshooting](docs/troubleshooting.md) · [Validation and known limits](docs/releases/0.3.1.md) · [Latest end-to-end checks](docs/e2e-validation-2026-09-21.md)
- [Report a bug or a Double Check experience](https://github.com/vgflutter/GiviLoop/issues/new/choose) · [Contributing](CONTRIBUTING.md) · [Roadmap](docs/roadmap.md)

Add `.giviloop/` to the reviewed repository's `.gitignore`: run files can contain source and prompts. Redaction is best effort. [Data handling](docs/usage.md#safety-and-legal).

Development checks: `npm test`, `npm run test:browser`, and `npm run test:package -- --browser`.

[MIT](LICENSE). Independent project; provider terms and model licenses apply separately.
