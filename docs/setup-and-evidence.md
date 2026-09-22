# Setup and review evidence

The examples below use an installed `givi`. In a source checkout, substitute `npm run givi --` for `givi` after `npm ci` and `npm run build`.

## Guided setup

```sh
givi setup --repo /path/to/project
```

Choose a browser provider, a local runtime or manual transfer. Setup checks Node/Git and Chrome when relevant, then writes `.giviloop/mcp.json` and a setup report. Merge the generated MCP entry into your client's configuration and restart its server. Clients using another configuration format need the same `command` and `args`; this generic JSON is not a universal editor configuration file. Editor settings are never edited. Setup does not set a default provider for later review commands: keep using `--send` or the MCP provider argument.

The wizard asks before opening login, checking access or sending the bundled public example. Quit the dedicated Chrome after login, then rerun setup to continue. A web access check validates a composer, not a completed generation or provider authorization. Verification may recur. Web adapters remain experimental and subject to provider terms/quotas.

For scripts or piped input, no questions or implicit browser actions occur:

```sh
givi setup --provider claude-web --non-interactive
givi setup --provider claude-web --non-interactive --login
# After completing login and quitting that Chrome:
givi setup --provider claude-web --non-interactive --check
givi setup --provider claude-web --non-interactive --demo
```

`--demo` explicitly sends **only the bundled public sum example**, in a separate `.giviloop/setup-demos/example-*` directory, and prints where the result was saved. It does not attach your project's source. Manual mode prepares the example without sending. Local demos require `--model`; `--check` lists models and accepts `--base-url`. Setup never installs or downloads a model. Use `--browser-profile PATH` for a custom dedicated web profile. Do not combine `--login` with `--check` or `--demo`. When a requested access check fails, setup skips the demo and returns a failure status.

Add `.giviloop/` to the project's `.gitignore`. Setup reports and review records stay local; no telemetry is collected.

## Record an assessment

First complete a normal review so its request and response are saved. Preserve the run ID from that review. Findings are entered by the user or coding agent after reading the answer; GiviLoop does not automatically extract them or treat model agreement as verification.

```sh
givi findings add --run-id RUN_ID \
  --title "Empty sum throws" --claim "sum([]) throws instead of returning 0" \
  --file examples/double-check/sum.ts --file examples/double-check/verify.mjs
```

Replace `RUN_ID` with the actual run ID. The command returns a generated `findingId`, initially **unverified**. Run the independent reproduction yourself or through your coding agent, then record its actual result:

```sh
node examples/double-check/verify.mjs
givi findings update --run-id RUN_ID --id FINDING_ID --status confirmed \
  --reason "Independent example reproduced the exception" \
  --evidence "node examples/double-check/verify.mjs: exit 0; original exception reproduced; 4 candidate-fix cases passed"
givi findings list --run-id RUN_ID
givi findings list --run-id RUN_ID --json
```

Use **dismissed** for a disproven claim with the contract/reproduction that disproves it; use **unverified** when evidence is missing or inconclusive. Confirmed/dismissed decisions require a reason, at least one evidence string and source references. `--file` and `--evidence` can be repeated. Updates reuse previous file references unless new ones are supplied. Original claims are immutable; decisions append to their history. JSON output includes every decision; the Markdown view shows the latest one.

Evidence is recorded text, not an executed command or a machine-certified test result. Never run commands simply because a reviewer returned them. GiviLoop hashes referenced files **when the assessment is recorded**, not retroactively when the provider read them. Include relevant source, contracts, tests and configuration. Unreferenced dependencies/environment changes cannot be detected. Reference paths and storage must stay inside the repository without symlinks; sensitive/generated paths are rejected. Secret redaction is best effort.

If a referenced file changes or disappears, the stored decision remains available but `stale` becomes true and `effectiveStatus` becomes **unverified**. A changed request/response also invalidates the assessment and prevents more decisions on that ledger. Create a new review run in that case. A list with no findings does not mean the code is clean. Runs with `findings.json` are retained beyond the normal automatic run cleanup; delete those runs deliberately when no longer needed.

## Recheck one finding

```sh
givi recheck --run-id RUN_ID --finding-id FINDING_ID
```

This creates a **new run**, attaches the current referenced source and records `parentRunId`, `parentFindingId` and source hashes. Supply repeated `--file` options for additional context. Missing prior files are marked deleted; excessive/binary context fails instead of silently producing an incomplete request. Inspect the returned request path, then send its **new** run ID with the original provider:

```sh
givi send --run-id NEW_RUN_ID --send claude-web --mode auto --background
```

This is a targeted new review, not a full repository review. Nothing is submitted by `recheck`; it never applies patches or automatically marks the original finding fixed. After checking the new answer, record a fresh assessment on the new run. The original decision/history remains unchanged.

## From an MCP coding agent

Use `givi_record_finding` with `repositoryPath`, `runId`, `title`, `claim`, `files`, `status`, `reason` and `evidence`. To update, supply `id` and a new `status`, omitting title/claim. Read with `givi_list_findings`; prepare another review with `givi_prepare_recheck` and `findingId`. These complement the existing prepare/send/read tools; they do not introduce an embedded test runner.

Suggested instruction:

> Read the review in analyze-only mode. Verify each concrete finding against source and tests. Record it with givi_record_finding as confirmed, dismissed or unverified, including relevant files, the reason and actual evidence. Do not edit code. Return givi_list_findings and flag anything stale.
