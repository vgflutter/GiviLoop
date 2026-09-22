# Product direction

Updated for 0.5.0, 23 September 2026. **Now implemented:** guided setup, structured finding decisions with evidence/history and file hashes, stale detection, and preparation of a targeted recheck linked to its parent. The host agent still verifies findings; GiviLoop does not execute/certify tests or automatically mark fixes resolved. [Current commands](setup-and-evidence.md). Remaining proposals below are not release commitments.

## Focus

Ship the existing workflow around two use cases: **Double Check** and **using existing web chat access instead of an additional model API call**. Keep GiviLoop open source and independent of a hosted GiviLoop service. The browser adapter remains experimental, with explicit access conditions; local runtimes and manual web transfer are already available. No additional engine, automatic multi-model panel or new verification framework is required for this release.

Collect useful findings, false positives, onboarding failures and repeat usage before choosing the next feature. Economic claims must distinguish API spending from unknown web/agent token consumption; see [costs and access](costs-and-access.md).

The review-to-agent loop already exists elsewhere: [CodeRabbit CLI](https://docs.coderabbit.ai/cli) supports local reviews and agent handoff; [revmux](https://github.com/umputun/revmux) describes supervised multi-agent review and finding verification. Merely calling two models is not a unique proposition. GiviLoop's proposed focus is a small, inspectable workflow with a reviewer the user chooses, local runtime support, and evidence for accepting or dismissing advice. Its value still needs to be demonstrated with users.

## Beyond the first evidence workflow

| Order | Proposed feature | User value | First useful version |
| --- | --- | --- | --- |
| 1 | **Richer evidence validation** | Spend less time chasing plausible but incorrect findings. | Structured records are shipped; next investigate portable evidence artifacts and broader context-change detection. |
| 2 | **Recheck after a fix** | Avoid repeatedly reviewing the same unchanged code. | Linked current-source requests and stale detection are shipped; next evaluate a verified resolved/still-present comparison without treating model agreement as proof. |
| 3 | **Repository review profiles** | Make a useful review repeatable without a long prompt. | Versioned provider/model, context rules, budgets and review focus: correctness, regression coverage or a specific repository contract. |
| 4 | **Context preview and explicit branch scope** | Know what the reviewer actually saw. | Preview included/omitted files and compare an explicit Git base and head, including relevant callers/tests within a visible budget. |
| 5 | **Portable review report** | Discuss a finding in an issue or PR and keep the decision. | Export Markdown/JSON with source snapshot, evidence, decisions and measured runtime usage. Local export first; automatic PR posting is separate. |

Validate the shipped evidence workflow with users before a multi-model panel. A panel introduces more context transfer, latency and correlated mistakes; disagreement can guide investigation but agreement should not automatically mark a finding confirmed.

## Double Check: current scope and future verification

1. Record the reviewed source snapshot and context omissions.
2. Request a small set of concrete findings from the chosen reviewer.
3. Let the coding agent validate source references and propose a reproduction. Text-only model agreement remains unverified.
4. Where repository policy permits test execution, keep verification isolated and bounded. Record the command, result and snapshot it tested; never execute shell text solely because a reviewer returned it.
5. Save each outcome and its evidence. A failed verifier, truncated answer or missing context cannot produce a clean result.

The first slice now exposes evidence-recording tools to the host agent. An embedded runner and machine-validated outcomes remain future work; they would need explicit repository commands, isolation and resource limits. See the [current Double Check recipe](double-check.md).

## Token and reasoning budget

Measure before promising savings. GiviLoop already records token counts reported by local runtimes; that excludes unobserved work in the calling agent and does not measure the ChatGPT web model's tokens.

Rechecking changed context and returning a compact verified report are plausible ways to reduce repeated work. Compare them with the same reviewer receiving full context. Count all observable reviewer/verifier calls, latency, and correct findings; mark unknown costs as unknown. A local model has hardware and energy costs, and a second review may increase total tokens while still being useful.

An optional later workflow could start with a local reviewer and escalate selected uncertain findings to another explicitly configured provider. Routing should follow an agreed budget and data-sharing policy; GiviLoop should not silently send code to a remote service.

## First adoption cycle after 0.5.0

The initial audience is developers who already use a coding agent and ask for a second opinion. The positioning is **a second review with a reviewer you choose, followed by evidence**, plus avoiding a separate API review charge when existing chat access is available. Do not sell unmeasured total-token savings or unrestricted website automation.

- Invite 5–10 developers to try one small real change and return for a second. Use the existing Double Check issue template for voluntary feedback; no telemetry or private-source collection.
- Measure installation/login/MCP friction, time to the first completed review, findings confirmed or dismissed, verification effort and whether users return within a week. Record actual counts and failure cases rather than setting a success claim in advance.
- Use the new short demo of a real bug confirmed and an explicitly author-supplied false claim dismissed. It labels synthetic controls and the live provider run, and links a reproducible example.
- Share the release and a specific request for feedback with relevant coding-agent/MCP and open-source communities. This is a proposed outreach plan; no community posts or messages have been sent.

Guided setup, structured finding outcomes and a recheck tied to current source are now implemented. Gather pilot feedback on these before adding engines. Setup generates a snippet without editing client settings; a composer check still does not validate generation. The new demo distinguishes a real provider finding from an author-supplied false-claim control.

## Community adoption experiment

Start with a small group of developers who already ask their agent for reviews. Invite them to try one real change and return for another, then collect setup problems, useful findings, false positives and the reasons they did or did not reuse it. Do not collect private source or introduce telemetry for this experiment.

Publish a short demo showing one finding confirmed and another dismissed, with the author and synthetic cases clearly identified. Link to the reproducible example, actual limitations and a simple contribution path. A local code change can be shown without publishing the developer's repository.

Before a broad launch, compare three workflows on a small disclosed corpus: the coding agent's own review, a manually requested second review, and that same second reviewer through GiviLoop. Include clean cases and failures, hold context/model settings comparable, and record active human time as well as latency. Repeat use and verified value matter more than stars or model count.
