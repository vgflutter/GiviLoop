# Roadmap

Focus: make a second review easy to request, independently assess and retain as evidence. Guided setup, saved reviewers, automatic task-end requests, findings, rechecks and report export are available; see the [usage reference](usage.md).

## Next priorities

1. Validate the workflow on real changes: first-review friction, confirmed bugs, false positives, verification time and repeat use. Compare with the same reviewer used manually and with the coding agent alone. Total token savings remain unmeasured.
2. Improve context selection: preview included/omitted files, relevant callers and tests, and explicit branch/base comparison. Current Git preparation compares against `HEAD`.
3. Strengthen evidence: portable reproduction artifacts and broader detection of changed context. Today the host agent verifies findings; GiviLoop records its assessment.
4. Evaluate resolved/still-present comparisons for targeted rechecks. A model agreeing with a fix is not proof that it works.

These are proposals, not release commitments. Gather usage evidence before adding more providers, a multi-model panel or an embedded test runner. Report feedback through the [Double Check experience form](https://github.com/vgflutter/GiviLoop/issues/new?template=double_check.yml).
