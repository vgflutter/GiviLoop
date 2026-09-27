# Agent token pilot — 2026-09-27

Source: `043f09729b4c1ea5e23cf961b4cd4e6832117947`; Codex `codex-cli 0.154.0-alpha.6.2`, model `gpt-6-astra`, effort `xhigh`; reviewer `claude-web`.

Current source checkout, not a validation of a published release. Existing Codex login; no API-billed control. The web model was not pinned.

`giviloop` explicitly asks the agent to use the external review instead of a
separate full self-review. `giviloop-normal` uses the ordinary coding prompt with
automatic review enabled. Both verify the external response and export a report.

**Finding:** this pilot does not establish token or cost savings over internal
self-review. The prompt change lowered aggregate GiviLoop token counts, but
increased uncached input and output. All ten implementations passed their
independent acceptance checks; all four web reviews completed and exported a
report for the correct review ID. No trial was discarded.

| Task | Arm | Independent checks / workflow | Agent input + output | Uncached input | Output | Seconds |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| allocation | normal | passed | 63,804 | 10,029 | 2,575 | 95 |
| allocation | no-second-review | passed | 62,448 | 6,335 | 1,969 | 70 |
| allocation | self-review | passed | 102,787 | 9,798 | 3,261 | 113 |
| allocation | giviloop | passed | 247,000 | 15,818 | 3,598 | 191 |
| ttl-cache | giviloop | passed | 310,487 | 29,353 | 5,166 | 249 |
| ttl-cache | self-review | passed | 87,462 | 10,764 | 3,738 | 126 |
| ttl-cache | no-second-review | passed | 82,741 | 7,836 | 3,097 | 107 |
| ttl-cache | normal | passed | 82,108 | 10,439 | 3,061 | 111 |
| allocation | giviloop-normal | passed | 263,195 | 19,093 | 3,334 | 184 |
| ttl-cache | giviloop-normal | passed | 333,201 | 18,035 | 4,766 | 261 |

## Paired observed-agent-token deltas

Positive values mean fewer observed agent tokens in the candidate; negative values mean more. Cached input is included in the aggregate above; it does not have the same cost as uncached input.

| Task | Baseline → candidate | Tokens saved (percentage of baseline) |
| --- | --- | ---: |
| allocation | normal → giviloop | -183,196 (-287.1%) |
| ttl-cache | normal → giviloop | -228,379 (-278.1%) |
| allocation | no-second-review → giviloop | -184,552 (-295.5%) |
| ttl-cache | no-second-review → giviloop | -227,746 (-275.3%) |
| allocation | self-review → giviloop | -144,213 (-140.3%) |
| ttl-cache | self-review → giviloop | -223,025 (-255.0%) |
| allocation | giviloop-normal → giviloop | 16,195 (6.2%) |
| ttl-cache | giviloop-normal → giviloop | 22,714 (6.8%) |
| allocation | normal → no-second-review | 1,356 (2.1%) |
| ttl-cache | normal → no-second-review | -633 (-0.8%) |

Two synthetic tasks; one observation per task/arm. No general savings rate or statistical significance. Failed and incomplete attempts remain visible.

Web tokens, total workflow tokens, money and quota consumption remain unknown. These results do not establish that an agent always performs a default second review.

[Method and reproduction](../token-benchmark.md). [Machine-readable results](token-pilot-2026-09-27.json).

## Execution order and observed review work

The first four arms ran in listed order on allocation and reverse order on the cache. The two `giviloop-normal` runs were added during the initial batch, before either web result was available, to directly test the prompt idea. They ran after the original eight sessions; they were not fully counterbalanced against the other arms. No trial was removed or rerun.

## Totals across the same two tasks

| Workflow | Observed agent input + output | Uncached input | Output |
| --- | ---: | ---: | ---: |
| Normal, no GiviLoop | 145,912 | 20,468 | 5,636 |
| Explicitly skip a second review, no GiviLoop | 145,189 | 14,171 | 5,066 |
| Explicit internal self-review | 190,249 | 20,562 | 6,999 |
| Normal automatic GiviLoop | 596,396 | 37,128 | 8,100 |
| GiviLoop with instruction to avoid duplicate review | 557,487 | 45,171 | 8,764 |

Without GiviLoop, skipping a second review changed the aggregate by **−0.5%**:
−2.1% on allocation, but +0.8% on the cache. This does not establish a fixed
"default second review" cost.

Within GiviLoop, the extra instruction changed aggregate tokens by **−6.5%**
(−6.2% and −6.8% on the two tasks). However, uncached input changed by **+21.7%**
and output by **+8.2%**. Fewer repeated cached tokens drove the lower aggregate;
it is not a lower measured bill or quota. These are descriptive observations,
not evidence of a causal or general savings rate.

The GiviLoop runs recorded seven dismissed observations or caveats and no
confirmed bugs. These are agent-recorded assessments, not seven independently
demonstrated reviewer errors. In one allocation review, the reviewer reported
a crash for an empty array; the task explicitly excluded empty arrays, but that
contract had not been included in the selected code. The agent reproduced the
out-of-domain behavior and correctly rejected the change. Other entries were
out-of-domain caveats, sometimes explicitly not claimed as bugs by the reviewer.
Recording and explaining these still added work. The acceptance checks passed
in every arm; this pilot does not demonstrate a quality advantage either.

## Improvements to test next

- Pass the actual task contract to the reviewer, so it can evaluate the intended
  domain instead of inferring it only from code and tests.
- Reduce MCP context and bookkeeping. This checkout exposes 20 tool definitions
  (22,778 serialized characters); the six automatic-workflow definitions account
  for 3,824 characters. These are character counts, **not a token-saving
  estimate**. A smaller tool surface and fewer result round trips need a new test.
- Avoid manufacturing findings from harmless caveats just to document that a
  review happened; keep real claim verification and relevant regression tests.
- Repeat on representative changes with known acceptance criteria and multiple
  trials before using a savings percentage in promotion.

The useful current claim remains an independently assessed second opinion,
using existing web access instead of a separate model API call. This pilot's
comparison uses Codex subscription sessions throughout, so it cannot put a price
on that avoided-API counterfactual.

Validation of the benchmark implementation: **234 project tests passed**,
including accounting, failed/missing samples, scoped review export, public-report
redaction by field allowlist, and independent grader mutation checks. Across the
ten live sessions, **185 independent acceptance cases/scenarios passed**.
