# Local inference engines

GiviLoop supports `llama-cpp`, `lmstudio` and `mlx` through their Chat Completions APIs. The provider name selects explicit discovery and validation rules; this is not an unrestricted remote OpenAI endpoint. Ollama and DwarfStar have provider-specific instructions below.

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

## Completion guarantees for llama.cpp, LM Studio and MLX

Defaults are a 300,000 ms deadline and a 4,096-token output cap. The client checks that UTF-8 prompt bytes plus the output allowance and a 512-token formatting reserve fit the selected context budget. This is deliberately conservative, not an exact tokenizer count. The budget uses verified server capacity for llama.cpp and LM Studio, or a 16,384-token client default for MLX. An explicit smaller budget further bounds the request; a larger one must fit verified server capacity where available.

A review is accepted only with one completed assistant response, the exact requested model ID and `finish_reason: "stop"`. Length-limited, empty, tool-call, malformed or explicitly truncated responses are rejected. Separately returned thinking fields are not saved. If raw thinking appears at the start of final content, GiviLoop asks for a working runtime reasoning parser instead of recording it as the answer. Prior successful answers survive failed attempts.

Request cancellation and HTTP deadlines include discovery, generation and response-body reads. GiviLoop does not retry a submitted inference automatically. Model identity comes from the configured runtime's metadata; it is not cryptographic proof of the loaded weights. The local runtime and its configuration remain part of the trust boundary.

The automated suite exercises these contracts against real loopback HTTP servers with fixtures. Fixture success does not establish production readiness for an untested runtime version or override an upstream experimental designation.

## Ollama

GiviLoop sends selected text context to a local Ollama server, waits for a completed answer, and saves it in the same run format used by the CLI and MCP. A browser, ChatGPT account and API key are not needed for this path. GiviLoop never downloads a model or switches to a remote provider automatically.

### Install and start

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

### Review a file

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

### Budgets and reasoning

Defaults are a 300,000 ms deadline, a 16,384-token context setting and a maximum of 2,048 generated tokens. Thinking can consume the output budget. If a model reaches its output limit or fails to finish, GiviLoop rejects the partial result and preserves an earlier successful answer.

Before inference, GiviLoop checks a deliberately conservative context budget: UTF-8 prompt bytes + requested output tokens + 512 must fit the configured context. This is a bound used for input selection, not an exact tokenizer count. It may reject a prompt that a tokenizer would fit. Select fewer files or increase the context within the model's advertised capacity; GiviLoop does not trim away source code silently. It also sends `truncate: false` and `shift: false` to Ollama. The verified runtime for this release is Ollama 0.34.2; older runtimes must support those native API options for equivalent overflow handling.

`--reasoning on` requests thinking on models that advertise support; `off` disables it when supported. `low`, `medium` and `high` are model-dependent. GPT-OSS requires a level: GiviLoop maps `on` to `medium` and rejects `off`, since that model cannot disable thinking. An omitted setting uses the runtime/model default. See [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking).

Only the final `message.content` is saved as the review; `message.thinking` is excluded. Usage comes from the native API's prompt and generation counts. Ollama does not provide a separate thinking-token count here, so GiviLoop leaves that field absent instead of estimating it. See the [native chat API](https://docs.ollama.com/api/chat).

GiviLoop preserves the installed model's sampling defaults. It does not force temperature zero: Qwen's model guidance warns that greedy decoding in thinking mode can cause repetition. See [Qwen3 sampling recommendations](https://huggingface.co/Qwen/Qwen3-1.7B#best-practices).

### Failure handling

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

## DwarfStar

GiviLoop supporta il server HTTP di [DwarfStar di antirez](https://github.com/antirez/ds4), repository ufficiale `antirez/ds4`. L'adapter usa `GET /v1/models` e `POST /v1/chat/completions`, su un indirizzo loopback. Non avvia un browser e non richiede un account ChatGPT.

L'integrazione è stata verificata sul codice upstream al commit `0aaea5a238fb41a35106a551e73c8409dfb751ac`, il 21 settembre 2026. Il server evolve rapidamente: upstream descrive il progetto come beta. La compatibilità verificata non equivale a certificare ogni futura versione o modello.

### Preparazione del server

DwarfStar richiede i GGUF supportati dal progetto: non è un runner generico per qualsiasi modello. Su Apple Silicon il percorso documentato parte da 64 GB con SSD streaming, oppure 96 GB per Flash Q2 residente. Flash Q2 occupa circa 81 GiB su disco; vanno aggiunte le risorse del runtime e del contesto. Consultare [requisiti Metal](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/METAL.md) e [modelli supportati](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/MODELS.md) prima di scaricare pesi.

Su una macchina adeguata, seguire il [setup ufficiale](https://github.com/antirez/ds4#start-here). Dopo compilazione e download del GGUF, avviare ad esempio:

```sh
./ds4-server -m /percorso/DeepSeek-V4-Flash.gguf --host 127.0.0.1 --port 8000 --ctx 32768
```

Il percorso del GGUF deve corrispondere al file realmente scaricato. Per un modello più grande della RAM, valutare `--ssd-streaming` seguendo la [guida upstream](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/SSD_STREAMING.md). Non disabilitare i controlli di memoria per forzare il caricamento.

GiviLoop non scarica automaticamente i pesi e non modifica il server. Sono accettati solo URL HTTP(S) su `localhost`, indirizzi `127.x.x.x` o `[::1]`, senza credenziali. I redirect sono rifiutati; non esiste fallback cloud. La configurazione e l'integrità del servizio locale restano sotto il controllo dell'utente.

### Scelta del modello e review

```sh
givi models --provider dwarfstar
givi doctor --provider dwarfstar
```

Se il server riporta `DeepSeek V4 Flash`, una review automatica può essere eseguita così:

```sh
givi prepare --repo /percorso/repository \
  --goal "Controlla il diff e proponi una correzione minima verificabile"
givi send --repo /percorso/repository \
  --send dwarfstar --model "DeepSeek V4 Flash" \
  --base-url http://127.0.0.1:8000 \
  --context-tokens 32768 --max-output-tokens 4096 --reasoning high
```

Usare sempre il nome restituito da `givi models`. DwarfStar espone alias compatibili, tra cui Flash e Pro, che possono puntare allo **stesso GGUF già caricato**. Se GiviLoop li trattasse come modelli distinti, potrebbe dichiarare una review Pro eseguita invece con Flash. L'adapter legge `name` dai metadati del server, richiede una corrispondenza esatta e omette `model` dalla richiesta di generazione: cambiare modello richiede riavviare `ds4-server` con un altro GGUF. Il nome identifica il modello secondo il runtime; non attesta hash o quantizzazione dei pesi. [API e alias upstream](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/docs/SERVER.md)

`--base-url` può terminare alla radice del server oppure in `/v1`. La porta predefinita è `8000`.

### Contesto, reasoning e completamento

Il contesto è fissato dal `--ctx` del server. In GiviLoop, `--context-tokens N` verifica che il server abbia almeno quella capacità: non rialloca la memoria del processo DwarfStar. Il server controlla il contesto effettivo del prompt; GiviLoop rifiuta una risposta terminata per esaurimento del budget.

Il controllo `--reasoning` usa i parametri nativi:

| Valore | Richiesta |
| --- | --- |
| `off` | `think: false` |
| `on` | `think: true`, livello predefinito del server |
| `low`, `medium`, `high` | `think: true`, `reasoning_effort` corrispondente |
| omesso | predefinito di DwarfStar |

Il significato effettivo dei livelli dipende dal modello e dal runtime. Il campo separato `reasoning_content` non viene inserito nella review. Sono restituiti solo la risposta finale e i contatori comunicati dal server; non vengono inventati token di reasoning quando upstream non li misura separatamente. [Implementazione del protocollo](https://github.com/antirez/ds4/blob/0aaea5a238fb41a35106a551e73c8409dfb751ac/ds4_server.c)

L'adapter accetta esclusivamente risposte con `finish_reason: "stop"`, un testo finale non vuoto e nessuna richiesta di tool. Timeout, cancellazioni, risposta troncata o metadati incoerenti producono un errore senza trasformare un frammento in una review completata. La richiesta non viene reinviata automaticamente. Il limite della risposta HTTP è 8 MiB; il timeout predefinito è 10 minuti.

### Validation scope

Ollama has completed real reviews on small known-bug fixtures; those checks are not a model-quality benchmark. DwarfStar was exercised with protocol fixtures and a native server using synthetic weights. Review quality with trained DwarfStar weights remains unvalidated on the available hardware. Returning a local review to a cloud coding agent shares that review with the agent provider.
