---
description: Write a comprehensive, dated session summary (all context + learnings) to docs/summary/
argument-hint: "[optional short descriptor]"
allowed-tools: Bash(date:*), Bash(git:*), Bash(gh:*), Bash(echo:*), Bash(mkdir:*), Read, Glob, Grep, Write
---

You are writing a durable, self-contained record of this working session so that a future engineer - or a future Claude with NO memory of this conversation - can fully understand what happened, why, and how to continue. Err toward completeness: this is an archive that is read on demand, not a file loaded into every prompt. Dump the context and everything learned.

## Facts gathered for you (ground the summary in these - do not contradict them)

- Now: !`date "+%Y-%m-%d %H:%M %Z"`
- Filename stamp: !`date "+%Y-%m-%d-%H%M"`
- Branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -30`
- Working tree: !`git status --short`
- Pull requests: !`gh pr list --state all --limit 20 2>/dev/null || echo "(gh unavailable)"`

## Step 1 - decide the output path

Write to: `docs/summary/<Filename stamp>-<descriptor>.md`

- Use the **Filename stamp** above verbatim (it already encodes date + time).
- **Descriptor:** if `$ARGUMENTS` is non-empty, slugify it (lowercase, alphanumeric, hyphen-separated). Otherwise derive a 3–6 word kebab-case descriptor capturing the session's main theme (e.g. `pnpm-monorepo-and-ci-gates`).
- Ensure `docs/summary/` exists (the Write tool creates parent directories; if unsure, `mkdir -p docs/summary` first).

## Step 2 - reconstruct everything

From the **full conversation**, reconstruct what was done this session, cross-checked against the git/PR facts above. Capture the *reasoning*, not just outcomes. Do not invent - if something is uncertain or you can't verify it, say so explicitly.

## Step 3 - write the file

Use this structure (omit a section only if it is genuinely empty):

```
# <Descriptive title> - <Now date>

**Branch:** … | **PRs:** … | **Scope:** <one line>

## TL;DR
3–5 sentences: what this session set out to do and the end state.

## What was done
Thematic or chronological bullets. For each: the concrete change AND why it was made.

## Key decisions & rationale
Every significant choice, the alternatives weighed, and WHY this one won. This is the
highest-value section - preserve the reasoning so it isn't relitigated later.

## Things learned / discovered
Non-obvious findings, version constraints, tool quirks, surprises, and mistakes made and
how they were fixed. Be concrete: exact versions, flags, commands, error modes.

## Current state
Branches, open/merged PRs, what is verified vs. still pending, where the code lives.
Enough that a reader can orient in a single pass.

## Conventions, commands & workflows
Anything established this session that future work must follow (commands to run,
branching/CI rules, quality gates, etc.).

## Known issues / caveats / risks
Anything fragile, untested, deferred, or likely to bite later.

## Next steps
Concrete, actionable follow-ups.

## References
Key files, specs, plans, docs, and PR links worth reading, with paths.
```

## Style

- Comprehensive but skimmable: short paragraphs, bullets, and tables where they help.
- Self-contained: assume the reader has zero prior context about this work.
- Specific over vague: prefer paths, versions, commands, commit SHAs, and PR numbers.
- Ground every claim in the conversation or the gathered facts above.

After writing, report the file path you created and a one-sentence description of its contents.
