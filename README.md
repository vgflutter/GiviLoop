# GiviLoop

**Double-check your code. Save API tokens with your existing web chat.**

GiviLoop sends selected code or Git changes to a second reviewer and brings the answer back to your coding agent. Keep the request, review and execution status together in your repository.

CLI + MCP · Web chat + local models · Open source · MIT

- **Double Check:** have your agent verify another model's findings before changing code.
- **Save API tokens on the second review:** use available web chat access instead of making another token-billed model API call. GiviLoop sends the selected context and brings back the answer; no model API key is required.

**What “token savings” means:** if you would otherwise buy that review through an API, this avoids its separate API input/output token charges. The web chat still uses its plan's quotas, and your coding agent still uses tokens to prepare context and check the answer. **Total token savings are not measured.** [Costs and access](docs/costs-and-access.md).

## See it work

[![Watch setup, review and evidence](https://raw.githubusercontent.com/vgflutter/GiviLoop/main/docs/media/double-check-preview.png)](https://github.com/vgflutter/GiviLoop/releases/download/v0.5.0/giviloop-double-check.mp4)

[Watch the demo (MP4)](https://github.com/vgflutter/GiviLoop/releases/download/v0.5.0/giviloop-double-check.mp4): guided setup, a live Claude review, a confirmed bug, an explicitly author-supplied false claim dismissed, and a recheck after an edit. Recorded with 0.5.0 on a public synthetic example. [Recording details](docs/demo.md).

## Try a first review

Requires Node.js 20+, Git and Google Chrome for the optional web integration.

```sh
git clone https://github.com/vgflutter/GiviLoop.git
cd GiviLoop
npm ci
npm run build
npm run givi -- setup
```

Setup checks prerequisites, lets you choose a reviewer and writes an MCP entry to `.giviloop/mcp.json` for you to merge into your client. Login, access checks and the bundled public demo are opt-in; editor settings are untouched. It saves your reviewer and browser preferences for this project. [Setup and evidence guide](docs/setup-and-evidence.md).

**With or without login:** GiviLoop can use ChatGPT anonymously when the website offers a usable chat. If login is required, run `npm run givi -- browser login`, sign in, quit that dedicated Chrome, then run `npm run givi -- browser check`. Availability and limits are controlled by the website.

```sh
npm run givi -- review --file examples/double-check/sum.ts \
  --question "Find a concrete bug, the smallest fix and regression tests."
```

GiviLoop saves the answer and prints its path. The example's `sum([])` should return zero but throws; ask your agent to check the finding before applying the fix. Run `node examples/double-check/verify.mjs` to reproduce this example independently.

**Do not use `--headless` for ChatGPT:** it is currently unsupported in practice; live checks were blocked by site verification both with and without login. Reviews now start minimized by default. Login, cookie choices, verification or uploads pause with **needs-attention** instead of deliberately showing Chrome. Use `status`, then `open` and `resume` when convenient; ZIP uploads require `resume --foreground`. OS-specific flashes remain possible.

**Web access is experimental.** OpenAI's European terms prohibit automatic output extraction; technical success, anonymous access and MIT licensing do not establish permission. [Costs and access](docs/costs-and-access.md).

**Choose a browser chat; no API keys:**

| `--send` | Real tests completed |
| --- | --- |
| `chatgpt-web` | With and without login |
| `claude-web` | Signed in, Free account |
| `gemini-web` | Without login |
| `deepseek-web` | Signed in; delivery passed, clean-code quality control failed |

**What happened with DeepSeek?** It found two deliberately introduced bugs, then reported a bug in the corrected code using negative quantities that the contract explicitly excluded. It also proposed an alternative cache key that can collide. The browser integration works; those suggestions should be rejected. This small test is not a model ranking. Verify findings from **every** reviewer before changing code. [Results and reproductions](docs/web-providers.md#signed-in-claude-and-deepseek-results-and-fixes).

For Claude, use `npm run givi -- browser login --provider claude-web`, quit that Chrome, then `npm run givi -- browser check --provider claude-web`. Substitute another name from the table as needed. New adapters accept inline text (`ask --file` / `prepare`); automated ZIP uploads and model selection remain ChatGPT-only. [Commands and validation](docs/web-providers.md).

Manual `copy --open` / `ingest` works with all four prompt formats. [Local models](docs/local-engines.md) and [Ollama](docs/ollama.md) remain available; [DwarfStar](docs/dwarfstar.md) trained-model validation is pending.

## Stay in your editor

After setup, `givi review` reviews your Git changes with the saved provider. `givi ask` and `givi prepare` still only prepare context unless you explicitly request sending.

- `givi status` — see progress, the saved answer and the next action.
- `givi open` / `givi resume` — handle a paused login/setup when convenient, then continue. Resume refuses requests already sent or of uncertain status.
- `givi cancel` — stop waiting; this cannot retract a prompt already sent.

MCP reuses a healthy minimized Chrome for subsequent reviews, with separate conversations, for up to 60 seconds idle. CLI commands close it after each review. [Defaults and controls](docs/setup-and-evidence.md#saved-defaults-and-quiet-reviews).

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
Use my saved reviewer. Keep the browser in the background.
Read the review in analyze-only mode. Verify each finding against the code
and tests; report confirmed, dismissed or unverified, with reasons.
Do not edit files.
```

The coding agent performs the verification. Ask it to **save findings with `givi_record_finding`**, including source/contract/test files, a reason and evidence. `givi_list_findings` reports confirmed, dismissed or unverified, with decision history; changed referenced files make the assessment stale. `givi_prepare_recheck` prepares a new request for one finding with current source, without sending it or applying fixes. [CLI equivalents and examples](docs/setup-and-evidence.md).

GiviLoop records the agent's assessment; it does not execute or certify tests. An empty finding list is not proof of clean code. [Full Double Check recipe](docs/double-check.md).

## Install, learn, contribute

- [Latest release and installable package](https://github.com/vgflutter/GiviLoop/releases/latest) · [CLI/MCP reference](docs/usage.md)
- [Current provider results](docs/web-providers.md) · [Troubleshooting](docs/troubleshooting.md) · [0.6.0 changes and limits](docs/releases/0.6.0.md)
- [Report a bug or a Double Check experience](https://github.com/vgflutter/GiviLoop/issues/new/choose) · [Contributing](CONTRIBUTING.md) · [Roadmap](docs/roadmap.md)

Add `.giviloop/` to the reviewed repository's `.gitignore`: run files can contain source and prompts. Redaction is best effort. [Data handling](docs/usage.md#safety-and-legal).

Help shape the next release: try one real change, verify a finding, then [share whether it helped or wasted time](https://github.com/vgflutter/GiviLoop/issues/new?template=double_check.yml). Public or synthetic examples only. Confirmed bugs, false positives and repeat use are more useful feedback than a successful model response alone.

Development checks: `npm test`, `npm run test:browser`, and `npm run test:package -- --browser`.

[MIT](LICENSE). Independent project; provider terms and model licenses apply separately.
