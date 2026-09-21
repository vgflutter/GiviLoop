# Local reviews with Ollama

GiviLoop sends selected text context to a local Ollama server, waits for a completed answer, and saves it in the same run format used by the CLI and MCP. A browser, ChatGPT account and API key are not needed for this path. GiviLoop never downloads a model or switches to a remote provider automatically.

## Install and start

Install [Ollama](https://ollama.com/download) for your operating system. On macOS with Homebrew:

```sh
brew install ollama
OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 ollama serve
```

Keep the server running, then use another terminal to download a model and list local models:

```sh
ollama pull qwen3:4b
givi models --provider ollama
givi doctor --provider ollama
```

Downloading weights uses the network. Review inference uses the configured loopback server. Ollama's cloud features can be disabled with `OLLAMA_NO_CLOUD=1`; if a server is already running, restart that server with the setting. See the [Ollama local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features).

The adapter also checks model metadata before sending source text and refuses models backed by a remote host, including renamed cloud aliases. It connects directly to loopback addresses, ignores environment HTTP proxies and refuses redirects. The local runtime remains part of the trust boundary: these checks do not turn an arbitrary proxy or a modified server into a trusted inference engine.

## Review a file

```sh
givi ask --repo /path/to/repo --file src/cart.ts \
  --question "Find concrete correctness bugs and propose regression tests." \
  --send ollama --model qwen3:4b --reasoning on \
  --context-tokens 16384 --max-output-tokens 8192 --max-wait-ms 300000
```

Or prepare a review of Git changes first and send it separately:

```sh
givi prepare --repo /path/to/repo
givi send --repo /path/to/repo --send ollama --model qwen3:4b \
  --reasoning on --max-output-tokens 8192 --context-tokens 16384
```

From a checkout, replace `givi` with `npm run givi --`. A non-default server can be selected with `--base-url http://127.0.0.1:11435`. Only loopback HTTP(S) URLs without credentials, query parameters or fragments are accepted. IPv6 loopback `[::1]` is also supported; `localhost` is pinned to `127.0.0.1`.

MCP exposes `givi_local_models`, `givi_ask_local_llm` and `givi_send_to_local_llm`. Choose `provider: "ollama"` and an explicit installed `model`; the schemas expose the same context, output, reasoning and timeout options. The existing response reader brings the saved review back to the agent as untrusted advisory text. Local inference accepts selected text files and diffs, not ZIP uploads.

## Budgets and reasoning

Defaults are a 300,000 ms deadline, a 16,384-token context setting and a maximum of 2,048 generated tokens. Thinking can consume the output budget. If a model reaches its output limit or fails to finish, GiviLoop rejects the partial result and preserves an earlier successful answer.

Before inference, GiviLoop checks a deliberately conservative context budget: UTF-8 prompt bytes + requested output tokens + 512 must fit the configured context. This is a bound used for input selection, not an exact tokenizer count. It may reject a prompt that a tokenizer would fit. Select fewer files or increase the context within the model's advertised capacity; GiviLoop does not trim away source code silently. It also sends `truncate: false` and `shift: false` to Ollama. The verified runtime for this release is Ollama 0.34.2; older runtimes must support those native API options for equivalent overflow handling.

`--reasoning on` requests thinking on models that advertise support; `off` disables it when supported. `low`, `medium` and `high` are model-dependent. GPT-OSS requires a level: GiviLoop maps `on` to `medium` and rejects `off`, since that model cannot disable thinking. An omitted setting uses the runtime/model default. See [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking).

Only the final `message.content` is saved as the review; `message.thinking` is excluded. Usage comes from the native API's prompt and generation counts. Ollama does not provide a separate thinking-token count here, so GiviLoop leaves that field absent instead of estimating it. See the [native chat API](https://docs.ollama.com/api/chat).

GiviLoop preserves the installed model's sampling defaults. It does not force temperature zero: Qwen's model guidance warns that greedy decoding in thinking mode can cause repetition. See [Qwen3 sampling recommendations](https://huggingface.co/Qwen/Qwen3-1.7B#best-practices).

## Failure handling

| Error | Action |
| --- | --- |
| `LOCAL_CONNECTION_FAILED` | Start Ollama and check the loopback host/port. |
| `LOCAL_HTTP_ERROR` | Verify the model is downloaded; check context, thinking support and server logs. Server error bodies are not copied into GiviLoop diagnostics. |
| `LOCAL_CLOUD_MODEL_REJECTED` | Select downloaded weights and restart Ollama with cloud disabled. |
| `LOCAL_MODEL_UNVERIFIED` | Update Ollama and inspect the selected model's local architecture metadata. |
| `LOCAL_CONTEXT_EXCEEDED` | Review fewer files or adjust the explicit context/output budgets within the model limit. |
| `LOCAL_REASONING_UNSUPPORTED` | Choose a supported thinking setting or model. |
| `LOCAL_TIMEOUT` / `LOCAL_CANCELLED` | The bounded request was interrupted. Inspect local server health before starting another run. |
| `LOCAL_RESPONSE_INCOMPLETE` | No complete review was saved. Increase the output budget, reduce the prompt or allow more time. |
| `LOCAL_MODEL_MISMATCH` / `LOCAL_RESPONSE_INVALID` | The runtime returned an unexpected model or response format. Investigate it before relying on its output. |

## Validation and model quality

On 2026-09-21, actual inference was exercised on a Mac with M5 Pro and 24 GB memory, using Ollama 0.34.2 bound to `127.0.0.1`, cloud disabled, and downloaded quantized weights. Initial direct adapter reviews asked two models to review a `takeLast(items, count)` implementation against an explicit contract. These initial runs used temperature zero, before the sampling fix described below:

| Model | Time | Input / generated tokens | Observed review quality |
| --- | --- | --- | --- |
| `qwen2.5-coder:3b` | 5.22 s | 100 / 396 | Completed, but missed the zero-count bug and suggested irrelevant changes. |
| `qwen3:1.7b`, thinking on | 6.56 s | 81 / 899 | Identified `slice(-0)` correctly and proposed the minimal fix with three correct tests. |

The three proposed cases were independently executed: the original failed the zero-count contract, and the corrected implementation passed all three. A separate real request with a 32-token generation cap was rejected as incomplete.

The full GiviLoop advisory prompt then exposed a limitation missed by the shorter direct prompt: Qwen3 1.7B exhausted a 4,096-token output budget on a simple `sum` review, and another attempt with 8,192 tokens also failed to finish after 66.1 seconds. GiviLoop correctly saved no partial answer. Preserving the model's recommended sampling defaults fixed the inappropriate greedy setting, but a 4,096-token trial still did not complete after 28.6 seconds.

A final trial with **`qwen3:4b`**, its sampling defaults, thinking enabled, a 16,384-token context and an 8,192-token output cap completed both wrapped `sum` and `takeLast` reviews in **73.5 seconds**, using 278 input and 5,367 generated tokens. It identified both bugs and both minimal fixes correctly. Six expected results passed independent tests. Its suggested array assertions used `===` against array literals, which is invalid for comparing array values in JavaScript; the independent checks used `assert.deepEqual`. Model feedback still needs review.

The example above therefore uses Qwen3 4B with an explicit larger thinking budget. These are small reproducible checks, not a general quality benchmark or a claim that a small local model matches a larger remote model. All three downloaded models occupy about 5.79 GB combined; [Qwen3 4B](https://ollama.com/library/qwen3:4b) alone is about 2.5 GB. Each model's license applies independently of GiviLoop's license.

Local reviews have no metered remote inference charge. Hardware, electricity and latency still matter, and returning the result to a cloud coding agent shares that result with the agent provider. Keep the entire workflow local if that is your privacy requirement.
