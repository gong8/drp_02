# Contributing

## Branching model

```
main   ← production. Protected. Only `dev` can merge in.
 ↑
dev    ← integration branch. The only branch that connects to main.
 ↑
feat/* ← feature branches. Branch off `dev`, merge back into `dev`.
```

- **`main`** is production-only. It receives changes **exclusively** through a
  Pull Request from **`dev`**, and only after CI passes. No direct pushes.
- **`dev`** is the integration branch. All feature work merges here first.
- **`feat/*`** branches are created **off `dev`** and merged back into `dev`.

### Workflow

1. Branch off `dev`:
   ```bash
   git checkout dev && git pull
   git checkout -b feat/my-thing
   ```
2. Open a PR into `dev` when ready. (CI does not run on feature → dev PRs.)
3. To ship to production, open a PR from `dev` → `main`. CI runs; on success it
   becomes mergeable, and merging triggers the CD (Android) build.

## What is enforced vs. convention

**Enforced by GitHub branch protection:**

- `main` requires a PR and passing checks (`guard`, `ci`); no direct pushes;
  no force-push or deletion.
- The `guard` check fails any PR into `main` whose source branch is not `dev`,
  so **only `dev` can merge into `main`**.
- CI runs only on PRs into `main`; CD runs on push to `main` and is therefore
  gated by CI (main can only be reached via a CI-passed `dev` → `main` merge).
- `dev` cannot be force-pushed or deleted.

**Convention only (GitHub cannot enforce where a branch is created from):**

- *"Feature branches must branch off `dev`, never `main`."* Git has no mechanism
  to restrict a branch's creation point. Please follow this convention; the
  merge-side rule (only `dev` → `main`) is what is actually enforced.
