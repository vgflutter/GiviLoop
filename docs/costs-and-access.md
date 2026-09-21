# Costs, tokens and chat access

GiviLoop has no hosted service or paid plan. Its two current use cases are a second review that your coding agent can verify, and using an existing chat account for that review instead of adding a separately billed model API call.

## What can be saved?

| Path | Additional model API charge from GiviLoop | What still has a cost or limit |
| --- | --- | --- |
| Web chat, manual or browser integration | No model API call is made | Chat subscription, website quotas, provider access conditions, agent work and human time. |
| Local model | No remote model API call is made | Hardware, electricity, model downloads, inference time and the calling agent's quota. |

If you would otherwise buy an API review, completing it through an already available chat account can avoid that particular API expense. If you would otherwise do no second review, adding one does not save that expense. This comparison says nothing about equal quality, model identity, context limits or latency.

GiviLoop does **not** measure web token usage, subscription quota consumption, total agent tokens or money saved. Runtime-reported local token counts are saved when available. A second review may increase total tokens even when it avoids incremental API billing. Do not turn unavailable measurements into a percentage-saved claim.

## Two different ways to use a website

**Manual transfer:** GiviLoop prepares the context and copies the prompt locally. You paste and send it on the website, copy the answer, then run `givi ingest`. The site interaction and answer retrieval are manual. This is available for ChatGPT and Claude prompt formats.

**Optional browser automation:** GiviLoop fills, sends and reads the ChatGPT page automatically, then saves the response. `--background` uses a minimized native Chrome window; it is not headless. Login and human verification still require the account holder when requested. The integration has completed real authenticated CLI/MCP reviews, but the website can change or refuse access.

OpenAI's European terms prohibit automatically or programmatically extracting data or output. That directly affects the automatic ChatGPT path described here; using clipboard buttons instead of DOM text does not create an exception. An existing subscription, open-source license or user-responsibility disclaimer does not establish permission. [Official terms](https://openai.com/policies/eu-terms-of-use/).

GiviLoop does not claim provider authorization for its browser integration. The manual workflow removes automatic website extraction; it is not a blanket certification for every account or use. Local inference is available for automatic reviews without this website dependency. [Detailed provider-access note](accesso-provider.md).

## A useful comparison to contribute

Try the same disclosed change with your normal review workflow and with GiviLoop. Record the context, reviewer, elapsed and active human time, confirmed bugs, false positives, and only the usage actually reported. Include the coding agent's verification work where observable. Keep unknown tokens and costs explicitly unknown. Never include credentials, private source or account screenshots in a public report.
