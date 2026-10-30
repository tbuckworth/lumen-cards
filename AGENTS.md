# Agent instructions

The instructions every coding agent in this repository follows. Codex reads this file directly; Claude Code reads it through the `@AGENTS.md` line in `CLAUDE.md`. Write rules that apply to both here, and keep Claude-only material in `CLAUDE.md`.

<!-- claude-tooling: codex checklist review -->
## Checklist review (Codex)

This repository runs one checklist review gate for Claude Code and Codex. The configuration
and the review chain live under `.claude/`; the Codex wiring is `.codex/hooks.json`, and the
reviewer is the `checklist-reviewer` subagent role in `.codex/agents/checklist-reviewer.toml`,
which pins its model. Claude Code reads this section too, through `CLAUDE.md`, but runs its
reviewer as the gate's block message says; the steps below are for Codex sessions.

- Codex runs only trusted project hooks and skips an untrusted one without a word, so until
  `.codex/hooks.json` is trusted in `/hooks` (again after any change to it) there is no gate.
  A commit that goes through with no review is the sign; check `/hooks`.
- When the gate blocks a command, spawn the reviewer it asks for: `spawn_agent` with
  `agent_type="checklist-reviewer"`, `fork_turns="none"` and no model override, with the
  gate's prompt as the message. The reviewer must not see the conversation that wrote the
  diff, and a hook refuses any other spawn of it. On a retry, send the new prompt to the same
  reviewer with `followup_task`, or spawn a fresh one if it is gone.
- To review before a gate asks, run `.venv/bin/claude-tooling review-prompt` (or use
  `$checklist-review`) and pass its output to a fresh reviewer the same way.
- Never write `.claude/reviews/` yourself: only the reviewer writes `verdict.json`, with
  `apply_patch`, and hooks refuse every other write there, from `apply_patch` or the shell.
  Reading it is allowed.
- A verdict is valid for exactly one diff hash. After fixing findings, re-stage (commit
  trigger) or commit (PR trigger) and run one new review; then retry the gated command. A
  commit that fails after the gate allowed it is retried with the same verdict.
- Under the commit trigger the review covers exactly the staged diff, so stage with
  `git add <paths>` in its own command and run a plain `git commit -m "…"`. The gate refuses
  `-a`, paths on the command line, `--only`, `--include`, `--pathspec-from-file`, `--patch`
  and `--interactive`, and any commit whose options it cannot parse.
- Run the commit as a command of its own, after any staging: the gate reads the staged diff
  before the command runs, so it refuses a commit that shares the command with anything that
  might change the index before or alongside it. Only navigation and read-only checks (`cd`,
  `git status`) may come first, and only a filter such as `tail` may take its output; the
  refusal lists what is allowed.
- Write a plain `git commit`, not one behind `eval`, `sh -c` text built from variables,
  `xargs` or a wrapper such as `timeout`: the gate refuses a commit it cannot read.
- Do not bypass the gate or treat a failing item as advisory.
<!-- /claude-tooling: codex checklist review -->
