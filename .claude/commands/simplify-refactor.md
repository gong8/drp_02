---
description: Massively-parallel, multi-lens code-quality review and refactor across the whole codebase (abstraction, dedup, component reuse, naming, complexity, dead code). Expensive by design - spawns dozens to ~100+ agents.
argument-hint: "[scope path/glob] [report|apply|aggressive]"
allowed-tools: Bash, Read, Glob, Grep, Write, Edit, Workflow, Agent, Task, Skill
---

You are running **`/simplify-refactor`** - a deliberately expensive, massively-parallel
code-quality pass over this repo. It does NOT add features or fix functional bugs; it makes the
existing, working code *cleaner*: less duplication, better-named, more reused, better abstracted,
simpler. The codebase is "mostly vibe-coded and very functional" - your job is to keep behavior
identical while raising quality.

> Cost: this command fans out **dozens to 100+ subagents** through the `Workflow` tool. That is
> intentional. Do not shrink the fan-out to save tokens - the user opted into the cost. Scale the
> fan-out to the size of the scope.

## Arguments (`$ARGUMENTS`)

Parse loosely from `$ARGUMENTS`:

- **Scope** - a path or glob (e.g. `apps/mobile`, `packages/shared`). Default: the whole repo
  **excluding** `archive/`, build output (`dist/`, `.expo/`, `node_modules/`), generated Drizzle
  migrations, and lockfiles. Tests (`*.test.ts`) are reviewed only for naming/duplication and are
  low priority - keep the budget on production code.
- **Mode** - one of:
  - `report` (DEFAULT) - review only. Produce a ranked refactor plan with concrete before/after
    sketches. **Change zero code.** Always start here.
  - `apply` - after the report, auto-apply only the **low-risk, behavior-preserving** refactors
    (dedup, extract a shared helper/component, mechanical rename) in **isolated git worktrees**,
    each verified by `pnpm lint && pnpm typecheck && pnpm test` and committed separately. Anything
    medium/high risk stays a proposal.
  - `aggressive` - like `apply` but also applies structural refactors the agents are confident in.
    Highest churn. Only when the user explicitly asks.

If mode is omitted, **report**.

## Method

Run as a single `Workflow` (the reference script is embedded below - adapt it, don't shrink it).
The shape is: **fan out wide to review, barrier to consolidate, adversarially verify, then
synthesize.**

### Phase 0 - Inventory (you, inline, before the workflow)

The workflow script can't touch the filesystem, so gather the work-list yourself first:

```bash
git ls-files '*.ts' '*.tsx' | grep -v '^archive/' | grep -v '\.test\.' | grep -v '\.d\.ts$' \
  | while read f; do printf '%s|%s\n' "$(wc -l < "$f" | tr -d ' ')" "$f"; done | sort -rn
```

Also capture the **existing shared surface** so reviewers can flag "should have reused X":
the design system (`apps/mobile/src/ui/`, `theme.ts`), the helper libs (`apps/mobile/src/lib/`,
`apps/api/src/`), and the shared logic/schemas (`packages/shared/src/`).

> **Gotcha:** the `Workflow` tool's separate `args` channel does NOT reliably reach an inline
> `script` (it arrives `undefined`). **Bake the Phase-0 inventory directly into the script** as a
> `const INV = {...}` literal (see the reference below). Don't rely on `args`.

### Phase 1 - Parallel multi-lens review (the wide fan-out)

Partition the work-list:
- **Hotspots** (the largest / most central files) get **one agent per lens** - perspective
  diversity where the mess concentrates.
- **Medium files** get **one comprehensive agent** applying all of that area's lenses.
- **Small files** are **batched by directory** into one agent each (which is also how you catch
  duplication and naming drift *between* sibling files).

Every reviewer reads the real file(s), is given the shared-surface inventory and the repo
conventions, and returns structured findings.

### Phase 2 - Cross-cutting sweep (barrier)

A handful of agents each take ONE theme across the *entire* scope (given all Phase-1 findings +
the inventory): cross-file duplication, component-reuse across screens, shared-helper extraction
across packages, naming consistency, dead/unused exports, convention drift. These need the global
view, so they run after a barrier.

### Phase 3 - Triage + cluster (barrier)

One strong agent consolidates every finding: merges duplicates, drops trivia, and groups the
survivors into coherent refactor **clusters** (epics). This is where 150 raw findings become ~15
real pieces of work.

### Phase 4 - Adversarial verification

Each cluster is handed to a skeptic agent **prompted to refute it** - re-read the files, confirm
the duplication/issue is real and the refactor is genuinely worthwhile and behavior-preserving.
Default to rejecting on doubt. Kill the false positives so the report is trustworthy, not noise.

### Phase 5 - Synthesis

One agent per surviving cluster writes the epic up: problem, concrete change steps, a before/after
sketch, files touched, effort (S/M/L/XL), risk, impact, a priority rank, and a ready-to-file
`linearTitle` + `linearBody`. A final agent writes the executive summary + ordered roadmap.

Priority ranking heuristic: **(impact x reach) / effort**, with ties broken toward lower risk.
"Reach" = how many call-sites/files the cluster touches.

### Phase 6 - Apply (only in `apply` / `aggressive` mode)

For each cluster marked low-risk (and structural ones too, in `aggressive`), in **priority order**:
spawn an implementer agent with `isolation: 'worktree'`, apply the change, run
`pnpm lint && pnpm typecheck && pnpm test`, and commit with a focused message
(`refactor(<area>): <what> (DRP-xx)`). If verification fails, the agent reverts that cluster and
reports it as blocked - never leave a broken tree. Commit **one cluster per commit**
(repo rule: modular, bisectable history).

## Lenses

| Lens | Looks for |
|------|-----------|
| `duplication` | Repeated logic/JSX/types/constants that should be extracted and shared |
| `abstraction` | Missing helpers; repeated patterns (fetch+poll+debounce, optimistic update, loading/error state) begging for a hook/util |
| `component-reuse` | Screens reimplementing what `ui/` already offers; inline styles that should be theme tokens; ad-hoc components |
| `naming` | Unclear/abbreviated/misleading/inconsistent function, variable, prop, and type names |
| `complexity` | Over-long functions/components, deep nesting, tangled state, god-files; split + simplify |
| `dead-code` | Unused exports, vars, imports, params, props; unreachable branches |
| `consistency` | Drift from repo conventions (below) and from sibling files |

## Repo conventions reviewers MUST respect (do not "fix" these as bugs)

- **No em dashes anywhere** - hyphens only (code, comments, docs).
- **Type chain:** data shapes are Zod schemas in `packages/shared`; tRPC procedures in
  `apps/api/src/router.ts` (+ `routers/`); the mobile client's types follow automatically. Never
  hand-write API types on the client (`import type { AppRouter }` only).
- `apps/api` is ESM - relative imports need `.js` extensions.
- Mobile imports `@bethere/api` **type-only** so Metro never bundles server code.
- The dev auth bypass, open CORS, and rate-limit are deliberate for this milestone (see
  `docs/tech-debt.md`) - not bugs.
- Do not touch `archive/`. Stay on Expo SDK 54 (see `CLAUDE.md`).

## Guardrails

- **Behavior must stay identical.** This is cleanup, not a rewrite. A refactor that changes a user-
  visible behavior is out of scope - flag it as a separate idea, don't do it.
- **Verify before you trust.** Every cluster in the report has survived an adversarial skeptic.
- **Report mode changes no code.** Apply mode changes code only behind worktree + green
  lint/typecheck/test, one cluster per commit.
- Prefer reusing the existing design system / helpers over inventing new abstractions. An
  abstraction with one call-site is usually wrong.

## Output

1. **Markdown report** at `docs/refactor/<YYYY-MM-DD>-refactor-report.md`: executive summary,
   prioritized roadmap table, then one section per cluster (problem, proposal, sketch, files,
   effort/risk/impact, priority). Use the current date (`date +%F`).
2. **Linear issues** (team `DRP_02`, via the Linear MCP): one issue per cluster, titled from
   `linearTitle`, body from `linearBody`, labelled `refactor` / tech-debt, left in `Todo`. Add a
   parent/tracking issue linking them, and reference the report path. Per `CLAUDE.md`, Linear is the
   source of truth - do not skip this.
3. In `apply`/`aggressive` mode, also: the commits made, and which clusters were applied vs blocked.

Finish by printing the report path, the Linear issue IDs, and a 3-5 line summary of the top wins.

## Reference workflow script

Adapt this - re-derive the inventory for the actual scope, keep the wide fan-out. It returns the
synthesized epics; you (the main loop) write the report and file the Linear issues.

```js
export const meta = {
  name: 'simplify-refactor',
  description: 'Multi-lens parallel code-quality review -> verified, prioritized refactor plan',
  phases: [
    { title: 'Review' }, { title: 'Cross-cut' }, { title: 'Triage' },
    { title: 'Verify' }, { title: 'Synthesize' },
  ],
}
const FINDINGS = { type:'object', required:['findings'], properties:{ findings:{ type:'array', items:{
  type:'object', required:['title','lens','files','problem','proposal','effort','risk','severity'],
  properties:{ title:{type:'string'}, lens:{type:'string'}, files:{type:'array',items:{type:'string'}},
    evidence:{type:'string'}, problem:{type:'string'}, proposal:{type:'string'},
    effort:{type:'string',enum:['S','M','L']}, risk:{type:'string',enum:['low','med','high']},
    reach:{type:'integer'}, severity:{type:'string',enum:['low','med','high']} } } } } }
const CLUSTERS = { type:'object', required:['clusters'], properties:{ clusters:{ type:'array', items:{
  type:'object', required:['key','title','findingIds'], properties:{ key:{type:'string'},
    title:{type:'string'}, theme:{type:'string'}, problem:{type:'string'},
    findingIds:{type:'array',items:{type:'string'}} } } } } }
const VERDICT = { type:'object', required:['isReal','confidence','reason'], properties:{
  isReal:{type:'boolean'}, confidence:{type:'string',enum:['low','med','high']},
  reason:{type:'string'}, refinedScope:{type:'string'} } }
const EPIC = { type:'object', required:['key','title','summary','changes','effort','risk','impact','priority','linearTitle','linearBody'],
  properties:{ key:{type:'string'}, title:{type:'string'}, summary:{type:'string'}, why:{type:'string'},
    changes:{type:'array',items:{type:'string'}}, sketch:{type:'string'}, filesTouched:{type:'array',items:{type:'string'}},
    effort:{type:'string',enum:['S','M','L','XL']}, risk:{type:'string',enum:['low','med','high']},
    impact:{type:'string',enum:['low','med','high']}, priority:{type:'integer'},
    linearTitle:{type:'string'}, linearBody:{type:'string'} } }

// Phase-0 inventory baked in (the inline-script `args` channel is unreliable - embed, don't pass):
const INV = {
  conventions: `...repo conventions block...`,
  designSystem: `...existing ui/ + lib/ + shared surface inventory...`,
  hotspots: [ /* the largest / most central file paths */ ],
  files: [ /* every in-scope source file as {path, lines}, from the git ls-files command */ ],
}
const CONV = INV.conventions
const SURFACE = INV.designSystem
const lensesFor = (area) => ({
  'fe-screen':['duplication','complexity','component-reuse','naming','abstraction','dead-code'],
  'fe-ui':['component-reuse','duplication','naming','consistency'],
  'fe-core':['duplication','abstraction','naming','complexity'],
  'be-router':['duplication','complexity','abstraction','naming','dead-code'],
  'be-db':['duplication','naming','consistency','abstraction'],
  'be-core':['duplication','naming','abstraction','consistency'],
  'shared-logic':['complexity','naming','abstraction','duplication'],
  'shared-schema':['duplication','naming','consistency','abstraction'],
}[area] || ['duplication','naming','complexity','abstraction'])
const areaOf = (p) =>
  p.includes('/screens/') ? 'fe-screen' : p.includes('/ui/') ? 'fe-ui' :
  p.includes('/routers/') ? 'be-router' : p.includes('apps/api/src/db/') ? 'be-db' :
  p.startsWith('apps/api/') ? 'be-core' : p.includes('shared/src/logic/') ? 'shared-logic' :
  p.includes('shared/src/schemas') ? 'shared-schema' : 'fe-core'
const CTX = `Repo conventions (respect, do not flag as bugs):\n${CONV}\n\nExisting shared surface (flag code that should reuse these):\n${SURFACE}`

// Phase 1 - review
phase('Review')
const HOT = new Set(INV.hotspots)
const reviewThunks = []
for (const f of INV.files) {
  const area = areaOf(f.path), lenses = lensesFor(area)
  if (HOT.has(f.path)) {
    for (const lens of lenses) reviewThunks.push(() => agent(
      `${CTX}\n\nReview ONLY through the "${lens}" lens. Read ${f.path} (${f.lines} lines) in full. `+
      `Report concrete, behavior-preserving cleanup findings with file:line evidence. No feature/bug work.`,
      { label:`${lens}:${f.path.split('/').pop()}`, phase:'Review', schema:FINDINGS }))
  } else if (f.lines >= 45) {
    reviewThunks.push(() => agent(
      `${CTX}\n\nReview ${f.path} (${f.lines} lines) across these lenses: ${lenses.join(', ')}. `+
      `Read it in full. Report concrete, behavior-preserving cleanup findings with file:line evidence.`,
      { label:`review:${f.path.split('/').pop()}`, phase:'Review', schema:FINDINGS }))
  }
}
// small files: batch by area
const small = {}
for (const f of INV.files) if (!HOT.has(f.path) && f.lines < 45) (small[areaOf(f.path)] ||= []).push(f)
for (const [area, fs] of Object.entries(small)) reviewThunks.push(() => agent(
  `${CTX}\n\nReview these ${fs.length} small ${area} files TOGETHER, especially duplication and `+
  `naming/structure drift BETWEEN them and vs the shared surface:\n${fs.map(x=>x.path).join('\n')}\n`+
  `Read each. Report concrete cleanup findings.`,
  { label:`batch:${area}`, phase:'Review', schema:FINDINGS }))
const reviewed = await parallel(reviewThunks)
let findings = reviewed.filter(Boolean).flatMap(r => r.findings || [])

// Phase 2 - cross-cut (barrier already passed)
phase('Cross-cut')
const THEMES = [
  ['cross-file duplication', 'identical/near-identical logic, types, or constants duplicated across files'],
  ['component reuse', 'screens reimplementing ui/ primitives or repeating JSX/style blocks that should be shared components or theme tokens'],
  ['shared helpers', 'utilities that should move into a shared lib or packages/shared (e.g. date/time formatting split across packages)'],
  ['naming consistency', 'inconsistent naming of the same concept across the codebase'],
  ['dead/unused exports', 'exports, helpers, props never used anywhere'],
  ['convention drift', 'places that diverge from the stated repo conventions'],
]
const compact = findings.map((f,i)=>`F${i}|${f.lens}|${(f.files||[]).join(',')}|${f.title}`).join('\n')
const crossed = await parallel(THEMES.map(([t,desc]) => () => agent(
  `${CTX}\n\nCross-cutting sweep, theme: ${t} - ${desc}. You may Grep/Read across the whole scope. `+
  `Phase-1 findings so far (for context, extend don't repeat):\n${compact}\n`+
  `Report NEW cross-file cleanup findings only.`,
  { label:`crosscut:${t.split(' ')[0]}`, phase:'Cross-cut', schema:FINDINGS })))
findings = findings.concat(crossed.filter(Boolean).flatMap(r => r.findings || []))
findings = findings.map((f,i)=>({ ...f, id:`F${i}` }))

// Phase 3 - triage + cluster
phase('Triage')
const allCompact = findings.map(f=>`${f.id}|${f.severity}|${f.lens}|${(f.files||[]).join(',')}|${f.title} :: ${f.problem}`).join('\n')
const clustering = await agent(
  `You are triaging code-quality findings. Merge duplicates, DROP trivia and anything that isn't a `+
  `clear, worthwhile, behavior-preserving cleanup, and group survivors into coherent refactor `+
  `clusters (each a single piece of work someone could pick up). Findings:\n${allCompact}\n`+
  `Return clusters referencing the finding ids.`,
  { label:'triage', phase:'Triage', schema:CLUSTERS })
const byId = Object.fromEntries(findings.map(f=>[f.id,f]))
const clusters = (clustering.clusters||[]).map(c => ({ ...c, findings: (c.findingIds||[]).map(id=>byId[id]).filter(Boolean) }))

// Phase 4 - adversarial verify (per cluster)
phase('Verify')
const verified = await parallel(clusters.map(c => () => agent(
  `${CTX}\n\nADVERSARIAL CHECK. A reviewer proposes this refactor cluster:\nTitle: ${c.title}\n`+
  `Problem: ${c.problem||''}\nEvidence findings:\n${c.findings.map(f=>`- [${f.files.join(',')}] ${f.title}: ${f.proposal}`).join('\n')}\n`+
  `Re-read the actual files. Try to REFUTE it: is the duplication/issue real, is the refactor `+
  `genuinely worthwhile, and is it behavior-preserving? Default isReal=false if doubtful.`,
  { label:`verify:${c.key}`, phase:'Verify', schema:VERDICT }).then(v => ({ ...c, verdict:v }))))
const real = verified.filter(Boolean).filter(c => c.verdict?.isReal)

// Phase 5 - synthesize epics
phase('Synthesize')
const epics = await parallel(real.map(c => () => agent(
  `${CTX}\n\nWrite up this verified refactor cluster as an actionable epic. Re-read files as needed.\n`+
  `Title: ${c.title}\nProblem: ${c.problem||''}\nVerifier note: ${c.verdict?.refinedScope||c.verdict?.reason||''}\n`+
  `Findings:\n${c.findings.map(f=>`- [${f.files.join(',')}] ${f.title}: ${f.proposal} (effort ${f.effort}, risk ${f.risk})`).join('\n')}\n`+
  `Give concrete change steps, a tight before/after sketch, files touched, effort/risk/impact, a `+
  `priority rank (1=highest, by (impact x reach)/effort), and a ready-to-file linearTitle + linearBody (markdown).`,
  { label:`epic:${c.key}`, phase:'Synthesize', schema:EPIC })))
return { epics: epics.filter(Boolean).sort((a,b)=>a.priority-b.priority),
  stats: { rawFindings: findings.length, clusters: clusters.length, verifiedClusters: real.length } }
```

## After the workflow

1. Sort `epics` by priority; write the markdown report (date-stamped path above).
2. Create the Linear issues (parent + one per epic) under `DRP_02`.
3. In apply mode, run Phase 6.
4. Print: report path, Linear IDs, top-5 wins.
