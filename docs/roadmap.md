# Product direction

Proposal for discussion, 21 September 2026. Items below are **not implemented or release commitments**. The current product packages selected context, requests a review, saves the response and returns it to a coding agent through CLI/MCP.

## Focus

Ship the existing workflow around two use cases: **Double Check** and **using existing web chat access instead of an additional model API call**. Keep GiviLoop open source and independent of a hosted GiviLoop service. The browser adapter remains experimental, with explicit access conditions; local runtimes and manual web transfer are already available. No additional engine, automatic multi-model panel or new verification framework is required for this release.

Collect useful findings, false positives, onboarding failures and repeat usage before choosing the next feature. Economic claims must distinguish API spending from unknown web/agent token consumption; see [costs and access](costs-and-access.md).

The review-to-agent loop already exists elsewhere: [CodeRabbit CLI](https://docs.coderabbit.ai/cli) supports local reviews and agent handoff; [revmux](https://github.com/umputun/revmux) describes supervised multi-agent review and finding verification. Merely calling two models is not a unique proposition. GiviLoop's proposed focus is a small, inspectable workflow with a reviewer the user chooses, local runtime support, and evidence for accepting or dismissing advice. Its value still needs to be demonstrated with users.

## After 0.3.0: priorities

| Order | Proposed feature | User value | First useful version |
| --- | --- | --- | --- |
| 1 | **Double Check with evidence** | Spend less time chasing plausible but incorrect findings. | A structured finding list, source references, explicit confirmed/dismissed/unverified outcomes, and attached reproduction or test evidence. |
| 2 | **Recheck after a fix** | Avoid repeatedly reviewing the same unchanged code. | Link a new snapshot to the earlier run, revisit affected findings, and show fixed/still present/unverified. Invalidate conclusions when relevant context changes. |
| 3 | **Repository review profiles** | Make a useful review repeatable without a long prompt. | Versioned provider/model, context rules, budgets and review focus: correctness, regression coverage or a specific repository contract. |
| 4 | **Context preview and explicit branch scope** | Know what the reviewer actually saw. | Preview included/omitted files and compare an explicit Git base and head, including relevant callers/tests within a visible budget. |
| 5 | **Portable review report** | Discuss a finding in an issue or PR and keep the decision. | Export Markdown/JSON with source snapshot, evidence, decisions and measured runtime usage. Local export first; automatic PR posting is separate. |

Build the smallest complete form of the first item before a multi-model panel. A panel introduces more context transfer, latency and correlated mistakes; disagreement can guide investigation but agreement should not automatically mark a finding confirmed.

## Double Check: proposed behavior

1. Record the reviewed source snapshot and context omissions.
2. Request a small set of concrete findings from the chosen reviewer.
3. Let the coding agent validate source references and propose a reproduction. Text-only model agreement remains unverified.
4. Where repository policy permits test execution, keep verification isolated and bounded. Record the command, result and snapshot it tested; never execute shell text solely because a reviewer returned it.
5. Save each outcome and its evidence. A failed verifier, truncated answer or missing context cannot produce a clean result.

The first slice could expose review and evidence-recording tools to the host agent without embedding a general-purpose test runner in GiviLoop. A subsequent runner would need explicit repository commands, isolation and resource limits. A dedicated command/tool and machine-validated outcomes are future work; the [current Double Check recipe](double-check.md) is usable now.

## Token and reasoning budget

Measure before promising savings. GiviLoop already records token counts reported by local runtimes; that excludes unobserved work in the calling agent and does not measure the ChatGPT web model's tokens.

Rechecking changed context and returning a compact verified report are plausible ways to reduce repeated work. Compare them with the same reviewer receiving full context. Count all observable reviewer/verifier calls, latency, and correct findings; mark unknown costs as unknown. A local model has hardware and energy costs, and a second review may increase total tokens while still being useful.

An optional later workflow could start with a local reviewer and escalate selected uncertain findings to another explicitly configured provider. Routing should follow an agreed budget and data-sharing policy; GiviLoop should not silently send code to a remote service.

## Community adoption experiment

Start with a small group of developers who already ask their agent for reviews. Invite them to try one real change and return for another, then collect setup problems, useful findings, false positives and the reasons they did or did not reuse it. Do not collect private source or introduce telemetry for this experiment.

Publish a short demo showing one finding confirmed and another dismissed, with the author and synthetic cases clearly identified. Link to the reproducible example, actual limitations and a simple contribution path. A local code change can be shown without publishing the developer's repository.

Before a broad launch, compare three workflows on a small disclosed corpus: the coding agent's own review, a manually requested second review, and that same second reviewer through GiviLoop. Include clean cases and failures, hold context/model settings comparable, and record active human time as well as latency. Repeat use and verified value matter more than stars or model count.
