# #82 — CD Deployment

`source: edstem thread #82`

**Question:** A student asks whether relying on a hosting platform's native GitHub integration (auto-deploy on push to `main`, with no explicit YAML config) is acceptable for CD, or whether a YAML-based pipeline is required. A follow-up asks whether a manually triggered release action (rather than a fully automatic one) satisfies the CD requirement.

**Answer (Mark Wheelhouse):** There are no constraints on which CI/CD platform is used. The requirement is that: (1) code is checked for compilation (and any other sanity checks deemed useful), and (2) passing builds are automatically pushed to the production/staging server. On the manual-trigger question, a single UI button click that then runs the full automated process will likely be accepted as CD, but following branching or tagging rules to control which commits reach production is strongly recommended.

**Answer (Jamie Willis):** Suggested running the app build and deploy only on `main` or designated release branches, and avoiding committing directly to those branches until ready to publish a new iteration, as a cleaner alternative to a manual trigger.
