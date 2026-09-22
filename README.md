# GiviLoop

**Double-check your code. Save API tokens with your existing web chat.**

GiviLoop sends selected code or Git changes to a second reviewer and brings the answer back to your coding agent. Keep the request, review and execution status together in your repository.

CLI + MCP · Web chat + local models · Open source · MIT

- **Double Check:** have your agent verify another model's findings before changing code.
- **Save API tokens on the second review:** use available web chat access instead of making another token-billed model API call. GiviLoop sends the selected context and brings back the answer; no model API key is required.

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
npm run givi -- browser check
```

**With or without login:** GiviLoop can use ChatGPT anonymously when the website offers a usable chat. If login is required, run `npm run givi -- browser login`, sign in, quit that dedicated Chrome, then repeat the check. Availability and limits are controlled by the website.

```sh
npm run givi -- ask --repo . --file examples/double-check/sum.ts \
  --question "Find a concrete bug, the smallest fix and regression tests." \
  --send chatgpt-web --mode auto --background
```

GiviLoop saves the answer and prints its path. The example's `sum([])` should return zero but throws; ask your agent to check the finding before applying the fix. Run `node examples/double-check/verify.mjs` to reproduce this example independently.

**Do not use `--headless` for ChatGPT:** it is currently unsupported in practice; live checks were blocked by site verification both with and without login. Use `--background`, which minimizes Chrome but can show a window at startup or during file uploads or initial website setup. Human verification may still require your action.

**Web access is experimental.** OpenAI's European terms prohibit automatic output extraction; technical success, anonymous access and MIT licensing do not establish permission. [Costs and access](docs/costs-and-access.md).

**More browser chats, no API keys:** `--send gemini-web` has completed real anonymous reviews. `deepseek-web` and `claude-web` have completed real signed-in reviews, including Claude Free. These adapters remain experimental; DeepSeek produced a false positive on a corrected-code control, so verify findings before applying changes. Run `browser login --provider NAME` if needed, quit that Chrome, then `browser check --provider NAME`. New adapters accept inline text (`ask --file` / `prepare`); automated ZIP uploads and model selection remain ChatGPT-only. [Commands and validation](docs/web-providers.md).

Manual `copy --open` / `ingest` works with all four prompt formats. [Local models](docs/local-engines.md) and [Ollama](docs/ollama.md) remain available; [DwarfStar](docs/dwarfstar.md) trained-model validation is pending.

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
- [Capabilities, live results and adoption assessment](docs/capabilities-and-validation-2026-09-22.md) · [Troubleshooting](docs/troubleshooting.md) · [Release limits](docs/releases/0.3.1.md)
- [Report a bug or a Double Check experience](https://github.com/vgflutter/GiviLoop/issues/new/choose) · [Contributing](CONTRIBUTING.md) · [Roadmap](docs/roadmap.md)

Add `.giviloop/` to the reviewed repository's `.gitignore`: run files can contain source and prompts. Redaction is best effort. [Data handling](docs/usage.md#safety-and-legal).

Development checks: `npm test`, `npm run test:browser`, and `npm run test:package -- --browser`.

[MIT](LICENSE). Independent project; provider terms and model licenses apply separately.
