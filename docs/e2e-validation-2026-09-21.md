# End-to-end refresh: 0.3.1

Checks on 21 September 2026, macOS arm64, Node 22.21.1. These checks cover actual transfers and concrete example verification; they are not a model-quality benchmark or a measurement of total token savings.

## Regression discovered during recording

A completed browser review could leave the CLI alive because a Chrome helper still held stderr open after the owned browser exited. The new regression timed out against 0.3.0 and passed after cleanup explicitly destroyed that pipe. The helper stayed alive, demonstrating that cleanup did not depend on killing it. The corrected live recording proceeds beyond review completion to MCP read and independent verification.

## Live provider checks

| Path | Completed work | Observed result |
| --- | --- | --- |
| CLI → authenticated ChatGPT background → MCP read | Public `sum.ts`, completed response, same-run MCP read, source unchanged | Empty-array bug and minimal correction identified. Four independent example cases. |
| MCP prepare Git diff → ChatGPT background → MCP read | Synthetic removal of the `count === 0` guard from `takeLast`, completed review in 23.9 s | Zero-count regression identified; source unchanged. Seven independent cases. No human verification requested in this run. |
| MCP → Ollama `qwen3:4b`, thinking on → MCP read | 23.9 s; 210 input / 1,902 generated tokens | Correct empty-array defect and correction. |
| MCP → llama.cpp `giviloop-qwen3-4b` → MCP read | 20.1 s; 210 input / 1,671 generated tokens | Correct empty-array defect and correction. |
| MCP → LM Studio `giviloop-qwen3-4b` → MCP read | 17.3 s; 210 input / 1,351 generated tokens, including 1,179 reasoning tokens | Correct empty-array defect and correction. |
| MCP → MLX `mlx-community/Qwen3-4B-4bit` → MCP read | 7.7 s; 208 input / 620 generated tokens | Correct proposed `reduce(..., 0)` correction, but incorrect explanation and risk claim. |

All four local transfers returned the saved response through MCP and preserved source files. Their timing includes the MCP call; usage counts come from the runtime. They are not interchangeable performance measurements: configurations, prompts and runtime behavior differ.

MLX incorrectly claimed that the original empty reduction returns `undefined`; it actually throws `TypeError`. It also claimed that an initial zero could interfere with arrays containing zero. The checked candidate produces the expected results for the documented examples. A plausible patch therefore does not make every accompanying claim correct. Broad claims of no risks or identical behavior for every JavaScript number were not established by these small fixtures.

The source-verification script never executes model output. The Git-diff trial independently checks the documented `slice(-0)` failure and a known candidate correction. Human/agent assessment of returned advice remains separate from transport success.

DwarfStar's HTTP adapter is covered by the automated suite and its previous native synthetic GPU check; trained-model inference was not rerun or claimed on insufficient hardware. Exact web-model selection, long web reasoning and live ZIP upload remain outside the validated scope. Headless access and provider-contract limitations are unchanged.

## Automated checks and reproduction

`npm run test:package -- --browser` builds and installs the actual archive in a clean consumer, runs all 145 unit tests and 15 isolated real-Chrome tests against the installed code, executes the packaged verification example and audits production dependencies. This covers CLI/MCP flows, manual copy/ingest association, local HTTP adapters, archive upload fixtures, model selection failures, cancellation, partial responses, verification handoff and one-send behavior.

The CI matrix runs Node 20/22/24 on Linux/macOS, with a Linux browser/package job. Executed results and counts are recorded in the CI run and package report; configured jobs alone are not evidence of a pass.

Opt-in live scripts send only synthetic code:

```sh
node scripts/live-e2e.mjs --web
node scripts/live-e2e.mjs --local
node scripts/record-demo.mjs
```

The local script expects the four explicitly named loaded models and runtimes above, using the settings in the [engine setup](local-engines.md) and [Ollama guide](ollama.md). It never installs weights or silently substitutes models. Live web checks require an available authenticated profile. Local evidence stays under `.giviloop/diagnostics/readme-refresh/` and is excluded from Git and the package.
