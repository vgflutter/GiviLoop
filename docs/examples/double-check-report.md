**Real development example:** Claude reviewed selected 0.7.0 changes. This report refers to the frozen pre-fix source; the corrupted-ledger issue is fixed in 0.7.0. The original selected context omitted the CLI error boundary relevant to the dismissed claim. This is a workflow example, not certification of the whole project or model quality.

# GiviLoop Double Check

Run: 2026-09-23T10-54-10-746Z-04fd30e1
Exported: 2026-09-23T10:58:50.451Z

**1 confirmed · 1 dismissed · 0 unverified** (0 stale)

These are recorded user/agent assessments. This exporter does not execute tests or certify evidence. An empty list is not proof of clean code.

Review state: **completed**. Provider: claude-web.

## Findings

### Unknown persisted verdict can produce a misleading empty summary

Status: **confirmed**. ID: F-b45a2b09.
Claim: A syntactically valid findings ledger with an unexpected decision status is accepted by the pre-fix reader. The exporter fails to count that finding among confirmed/dismissed/unverified.
Reason: Independently reproduced against the pre-fix build. The regression failed with Missing expected exception, then passed after adding an explicit verdict/history validation guard in the ledger reader. The report refers to the frozen pre-fix source snapshot; the release includes the correction. The suggested permissive counter fallback was not adopted.
Assessed: 2026-09-23T10:58:50.445Z

Evidence recorded:

- node --test --test-name-pattern="corrupted persisted" test/adoption-flow.test.mjs in the GiviLoop checkout: 1 failed before the fix, 1 passed after it.
- The case changes a persisted decision status to unexpected-verdict. Export now rejects it instead of creating a report.

Referenced files and hashes at assessment time:

- src/review-report.ts — 0fb07f99ac716073dde13df297f38d5800041b05792def8574c68e91a986ff0c
- src/review-evidence.ts — 4e0cbbe305d21a36e8c6f426235c2617960e777b76733fcb046a1508ddf80c56
- test/adoption-flow.test.mjs — da8196bb0bfe5924937c31fa770c4d66679baa3c5babc46f1222c993ac1d1cba

### Malformed demo JSON produces an unhandled CLI stack trace

Status: **dismissed**. ID: F-c74fe072.
Claim: The reviewer reported that malformed demo pointer JSON escapes as an unhandled raw stack trace.
Reason: The CLI already catches errors from runDemo and prints a GiviLoop error message with a nonzero exit. The reviewer did not receive the CLI error boundary in its original selected context. The parser message can still be technical, but the claimed unhandled stack is not reproduced.
Assessed: 2026-09-23T10:58:50.447Z

Evidence recorded:

- The controlled demo test writes malformed pointer JSON, invokes demo --finish and checks exit 1, the GiviLoop error prefix and absence of stack frames.
- node --test test/adoption-flow.test.mjs: all 8 adoption tests passed, including malformed JSON, modified verifier rejection and no duplicate offline finding.

Referenced files and hashes at assessment time:

- src/demo.ts — 14a355cc1fb9a476b13932f41e9922cd3d5f43dfb4ec5575a23c9cd32932a4cd
- src/cli.ts — bfa44f3ffe8e4f10d7f74c1948d800d872ecd02ef385126d369e374ff2bae978
- test/adoption-flow.test.mjs — da8196bb0bfe5924937c31fa770c4d66679baa3c5babc46f1222c993ac1d1cba

## Scope and provenance

Preparation: git-only.
Request SHA-256: 486c492bc295fc283eaac98e2ea59886a1308585c4581a869dcc3776ea842df1
Response SHA-256: a08ccf6a0cbec917a43aa5c212b0a78754298e13661a4f4af93c36b209a73868

File hashes above describe the source when each assessment was recorded, not necessarily the source originally reviewed. Unreferenced files and environment changes are not tracked. Full decision history remains in the local finding ledger.

This export omits the raw request, response and source files. Evidence text and filenames may still be sensitive; inspect before sharing. Redaction is best effort. Nothing was posted or uploaded by this export.

Web review token usage and total token savings are unknown. Existing web access avoids a separate model API call through GiviLoop; chat quotas still apply.
