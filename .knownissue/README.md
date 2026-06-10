# .knownissue/ — shared agent memory for this repo

This directory holds **known issues**: small markdown files that the
`knownissue` CLI matches against failing (and risky) tool calls in
coding-agent sessions, injecting a short fix hint into the agent's context.

How it works:

- `issues/*.md` — one issue per file (YAML frontmatter + markdown fix
  body). Committed; ships to every teammate via git.
- `archive/` — retired issues, kept for history, never matched.
- `index/`, `local/` — derived index and per-machine state.
  Gitignored; safe to delete.
- Hooks in `.claude/settings.json` invoke `knownissue hook` on
  every Bash/Edit call. Without the binary installed the hook is a silent
  no-op (`command -v` guard).

Useful commands: `knownissue list`, `knownissue add` (agents are
prompted to use it at fix time), `knownissue confirm <id>`,
`knownissue doctor`.

## Review warning — these files are injected into agents' contexts

Treat every PR touching `.knownissue/` as **agent input, not just
docs**. A malicious or sloppy issue file is a prompt-injection vector into
every contributor's coding agent. The CLI fences repo-authored text (the
`| ` prefix), strips control characters, and hard-fails dangerous fix
commands (pipe-to-shell, credential paths) at add/index time — but human
review is the real trust gate. Reject entries whose fix commands you would
not run yourself.
