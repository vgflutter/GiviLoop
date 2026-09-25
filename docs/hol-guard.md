# Optional HOL Guard integration

GiviLoop works without HOL Guard. An external `command.givi` extension is being
prepared for contribution to [HOL Guard](https://github.com/hashgraph-online/hol-guard).
It is not yet an accepted or released integration and is not enabled on your device.

## How it would work

When the extension is available and explicitly enabled by the local administrator,
HOL Guard evaluates supported shell commands before the agent executes them.
Its existing policies determine whether they proceed, need review, or are blocked.
An approval is not another GiviLoop model review and does not verify a finding's truth.

The first contribution covers these direct `givi` invocations:

| Permission | Operations | Why |
| --- | --- | --- |
| Automatic-review configuration | `auto-review enable`, `disable`, `acknowledge` | Change automation configuration or acknowledgement history |
| Automatic-review execution | `auto-review run` | May submit selected code and write review artifacts |
| Finding decisions | `findings add`, `update` | Create or change a recorded assessment |

All three permissions propose a `review` baseline. Stronger independent Guard
policies still apply. An external extension is inactive until locally enabled;
disabling the extension makes it inert, while disabling an active permission can
block the corresponding operations. A new human prompt on every call is not promised.

`auto-review status`, `findings list`, their bare-command shortcuts, and `report`
receive no added requirement from this extension. This does not globally allow
them. `report` can write a local Markdown file and is not purely read-only.

## Boundaries

- Direct MCP calls and MCP server startup are excluded. In particular, the normal
  automatic MCP workflow is not covered by this CLI extension.
- Other commands, including `review`, `opinion`, `send`, `ask --send`, `resume`,
  setup and browser management, are outside this first contribution.
- npm scripts, generic Node `cli.js` paths and Windows `.cmd`/`.exe` wrappers are
  not claimed as supported. A generic Guard review does not prove GiviLoop recognition.
- Recognition of the executable name is not authentication of the binary. Coverage
  depends on the agent's shell event reaching Guard; this is not child-process monitoring.
- Use canonical forms such as `givi findings update --run-id RUN --id FINDING ...`.
  Compact short options before the action and delimiter-separated actions are not
  claimed as supported. Other Guard policies still apply to unsupported forms.
- GiviLoop still requires explicit run IDs for finding writes and binds finding
  updates to their original run. Guard does not supply IDs, select the latest run,
  rewrite arguments, or certify evidence.

## Contribution and activation

The implementation belongs in HOL Guard: a declarative command source, source-bound
native fixtures, an external trust-map entry, documentation and generated catalog
artifacts. It does not add a runtime dependency, install hooks, alter local Guard
policies, or start a real reviewer in GiviLoop.

A draft PR, maintainer acceptance, release and local activation are separate steps.
Native fixtures evaluate commands as data and must report zero target executions;
they do not demonstrate MCP coverage or real provider access. Exact tested revisions
and validation results belong in the contribution's PR description.
