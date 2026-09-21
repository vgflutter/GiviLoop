# Additional local inference engines

GiviLoop supports `llama-cpp`, `lmstudio` and `mlx` through their Chat Completions APIs. The provider name selects explicit discovery and validation rules; this is not an unrestricted remote OpenAI endpoint. For Ollama and DwarfStar, see their separate guides.

| Provider | Default URL | Model discovery | Context handling | Explicit reasoning option |
| --- | --- | --- | --- | --- |
| `llama-cpp` | `http://127.0.0.1:8080` | One loaded GGUF from `/v1/models` | Active `/props` capacity verified | Only when the chat template advertises reasoning-effort support |
| `lmstudio` | `http://127.0.0.1:1234` | Loaded instances verified against both native and compatible model APIs | Loaded instance capacity verified | Rejected; configure the runtime and omit the option |
| `mlx` | `http://127.0.0.1:8081` | Cached/local IDs advertised by `mlx_lm.server` | Client budget only; runtime capacity is not exposed | Rejected; configure the runtime and omit the option |

All three accept a server root or `/v1` in `--base-url`. Connections stay on loopback and ignore environment proxies. Redirects are rejected. There is no automatic provider fallback, model download, runtime installation, alternate model selection or archive upload during inference.

## llama.cpp

Start a single-model server using an existing GGUF. For example, with a Qwen3 model:

```sh
llama-server --model /path/to/Qwen3-4B-Q4_K_M.gguf \
  --alias giviloop-qwen3-4b --host 127.0.0.1 --port 8080 \
  --ctx-size 16384 --parallel 1 --no-context-shift --offline \
  --reasoning-format deepseek --temp 0.6 --top-k 20 --top-p 0.95

givi models --provider llama-cpp
givi ask --repo /path/to/repo --file src/cart.ts \
  --question "Identify a concrete bug, its minimal fix and regression cases." \
  --send llama-cpp --model giviloop-qwen3-4b \
  --context-tokens 16384 --max-output-tokens 8192 --max-wait-ms 300000
```

The adapter verifies the exact advertised alias, GGUF metadata and active context capacity. Router mode is currently rejected because its global properties do not identify one unambiguous active model. Changing `--context-tokens` in GiviLoop does not reload the model or change the server's context allocation; restart the server to increase capacity. The server's [API and startup options](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) describe these endpoints.

When `/props` advertises `supports_reasoning_effort: true`, GiviLoop accepts reasoning levels, maps `on` to `medium`, and maps `off` to `none`. Otherwise any explicit reasoning flag is rejected. A model can support thinking while its template cannot switch it off. The tested Qwen3 GGUF hardcodes a thinking prefix: sending `enable_thinking: false` did not disable it. Omit GiviLoop's flag to use that template's normal behavior. The adapter requests separate reasoning output and saves only final answer text.

Sampling stays under the runtime/model's control. The example's Qwen3 settings follow its [model guidance](https://huggingface.co/Qwen/Qwen3-4B#best-practices); choose settings appropriate to other models.

## LM Studio

Install LM Studio, download a model deliberately, and load it with a fixed identifier and context allocation. Keep LM Link disabled when inference must remain on this computer:

```sh
lms link disable
lms ls
lms load YOUR_DOWNLOADED_MODEL_KEY --identifier giviloop-review --context-length 16384
lms server start --bind 127.0.0.1 --port 1234

givi models --provider lmstudio
givi ask --repo /path/to/repo --file src/cart.ts \
  --question "Review correctness and suggest focused tests." \
  --send lmstudio --model giviloop-review \
  --context-tokens 16384 --max-output-tokens 8192
```

See the official [load command](https://lmstudio.ai/docs/cli/local-models/load) and [server command](https://lmstudio.ai/docs/cli/serve/server-start). GiviLoop requires a version with `/api/v1/models` and only offers already loaded LLM instances with context metadata. Unloaded models exposed through just-in-time loading are excluded. The [native model metadata](https://lmstudio.ai/docs/developer/rest/list) describes instance IDs and context lengths.

Reasoning control is not among the documented supported parameters for this adapter's [Chat Completions route](https://lmstudio.ai/docs/developer/openai-compat/chat-completions). Configure it in LM Studio instead of passing a setting that could be ignored. This adapter does not silently switch to the separate native chat route.

LM Link can forward a localhost request to another computer without changing the API shape. GiviLoop cannot attest physical execution location from these metadata alone; use a trusted runtime with LM Link disabled for same-computer inference. See [LM Link routing](https://lmstudio.ai/docs/developer/core/lmlink).

The current adapter does not supply an API token. A server that requires authentication will fail explicitly; credentials embedded in the URL are never accepted. Keep existing access protections appropriate to your environment rather than assuming this adapter configures the server for you.

## MLX-LM on Apple Silicon

MLX support targets the local `mlx_lm.server` implementation. Upstream explicitly warns that this server is **not recommended for production** because its security checks are basic. GiviLoop exposes this as an experimental local integration and does not change that upstream limitation. The inspected [server source](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py) defines its endpoints and startup arguments.

Use an isolated Python environment and an already downloaded MLX model directory. Example Qwen3 startup:

```sh
python3 -m venv /path/to/mlx-venv
/path/to/mlx-venv/bin/pip install mlx-lm
HF_HUB_OFFLINE=1 /path/to/mlx-venv/bin/python -m mlx_lm.server \
  --model /absolute/path/to/downloaded-Qwen3-MLX \
  --host 127.0.0.1 --port 8081 \
  --chat-template-args '{"enable_thinking":true}' \
  --temp 0.6 --top-p 0.95 --top-k 20 --max-tokens 8192

givi models --provider mlx
givi ask --repo /path/to/repo --file src/cart.ts \
  --question "Find concrete correctness problems and minimal fixes." \
  --send mlx --model /absolute/path/to/downloaded-Qwen3-MLX \
  --context-tokens 16384 --max-output-tokens 8192
```

Use exactly the model ID returned by discovery. GiviLoop rejects IDs absent from that list and the ambiguous `default_model` alias. MLX discovery describes cached model repositories or an existing model directory; it does not expose active context capacity or thinking capabilities. Accordingly, `--context-tokens` is only GiviLoop's conservative client budget here, not a verified model limit or server setting. It does not guarantee runtime overflow behavior. Explicit reasoning options are rejected; configure the model's chat template in the runtime and omit the option.

Download all model files before starting the offline server. `HF_HUB_OFFLINE=1` prevents the runtime's Hugging Face client from fetching missing files during a review; incomplete caches fail instead. See the [Hugging Face offline setting](https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables#hfhuboffline).

## Common completion guarantees

Defaults are a 300,000 ms deadline and a 4,096-token output cap. The client checks that UTF-8 prompt bytes plus the output allowance and a 512-token formatting reserve fit the selected context budget. This is deliberately conservative, not an exact tokenizer count. The budget uses verified server capacity for llama.cpp and LM Studio, or a 16,384-token client default for MLX. An explicit smaller budget further bounds the request; a larger one must fit verified server capacity where available.

A review is accepted only with one completed assistant response, the exact requested model ID and `finish_reason: "stop"`. Length-limited, empty, tool-call, malformed or explicitly truncated responses are rejected. Separately returned thinking fields are not saved. If raw thinking appears at the start of final content, GiviLoop asks for a working runtime reasoning parser instead of recording it as the answer. Prior successful answers survive failed attempts.

Request cancellation and HTTP deadlines include discovery, generation and response-body reads. GiviLoop does not retry a submitted inference automatically. Model identity comes from the configured runtime's metadata; it is not cryptographic proof of the loaded weights. The local runtime and its configuration remain part of the trust boundary.

The automated suite exercises these contracts against real loopback HTTP servers with fixtures. Live engine/model tests are reported separately in release evidence; fixture success does not establish production readiness for an untested runtime version or override an upstream experimental designation.
