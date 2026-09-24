# GiviLoop skill installation checks

The skill lives in [`skills/giviloop-review/SKILL.md`](../skills/giviloop-review/SKILL.md). See the [README](../README.md#install-the-giviloop-review-skill) for prerequisites, the public installation command and usage.

## Verify a local revision

Discovery and installation are checked with `skills@1.7.0` in a temporary consumer outside the source checkout. Replace `/absolute/path/to/GiviLoop` below with your checkout. Run this in a subshell so the temporary environment settings do not persist:

```sh
(
  skill_source=/absolute/path/to/GiviLoop
  skill_check_dir=$(mktemp -d)
  cd "$skill_check_dir" || exit 1
  export DISABLE_TELEMETRY=1
  export XDG_STATE_HOME="$skill_check_dir/state"
  export npm_config_cache="$skill_check_dir/npm-cache"
  npx --yes skills@1.7.0 add "$skill_source" --list &&
  npx --yes skills@1.7.0 add "$skill_source" --skill giviloop-review --agent codex --copy -y &&
  npx --yes skills@1.7.0 list --agent codex &&
  cmp "$skill_source/skills/giviloop-review/SKILL.md" .agents/skills/giviloop-review/SKILL.md
)
```

Expect one discovered skill, a project-scoped installation under `.agents/skills/giviloop-review`, and an identical `SKILL.md` (`cmp` exits zero). The installation, npm cache and CLI state stay temporary; no global installation or personal agent configuration changes are needed. These checks do not send code to a reviewer, run a model, or configure GiviLoop/MCP.

Validate the YAML frontmatter and skill structure as well. Installation discovery alone does not verify the workflow: check documented CLI options and MCP fields against the current source, especially preparation versus sending and explicit run IDs.

## Public verification and listing

The published version at commit `552e409` was installed from `vgflutter/GiviLoop` with `skills@1.7.0` in a fresh temporary project, and its installed skill matched the source. A local check of subsequent edits does not verify those edits on GitHub; repeat the public-source check after publishing them.

See the [skills CLI documentation](https://skills.sh/docs/cli) and [installation options](https://github.com/vercel-labs/skills#install-a-skill). According to the [skills.sh FAQ](https://skills.sh/docs/faq), public installs with telemetry contribute to leaderboard discovery. Telemetry-disabled checks do not establish a public listing, and a leaderboard listing has not been verified. No npm release of GiviLoop is needed to distribute the Git-hosted skill.
