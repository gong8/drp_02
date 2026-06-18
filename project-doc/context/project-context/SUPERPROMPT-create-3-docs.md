# Superprompt: generate the 3 DRP documentation deliverables

Paste the block below to Claude Code, run from the repo root (`/Users/gong/Programming/drp_02`).

---

You are producing the DRP "Project Documentation" submission for BeThere, a group meetup-coordination app (Expo React Native + Fastify/tRPC/Postgres). This is graded coursework worth 20% of the module. Work only from the real evidence in this repository. Invent nothing.

## Objective

Produce three separate, submission-ready documents:

1. `hcd-portfolio.md` - Human Centred Design Techniques Portfolio (80% of the documentation mark)
2. `pitch-leaflet.md` - Project Pitch Leaflet (10%), single A4 of content
3. `copyright-legal-report.md` - Copyright / Legal Issues Report (10%), one side

Write them into `docs/m4-final/` (create it). Keep them as three separate files.

## Read first, in this order

1. `docs/FINAL PROJECT CONTEXT/00-CHRONOLOGICAL-TIMELINE.md` - the merged project record (2418 events, Mar to Jun 2026). Read the header (team roster, source legend, caveats) and the appendix (artifact index) in full, then read the timeline body for the design decisions, pivots, and what was cut.
2. The Trello board snapshot at the end of that file. Each card is a user need / user story carrying an attributed interviewee evidence quote and post-test feedback. This is your primary finding-to-change source.
3. `docs/FINAL PROJECT CONTEXT/drp-context/interviews/**` and `docs/FINAL PROJECT CONTEXT/drp-context/Friend Meetup Dynamics Survey (Responses) - Form Responses 1.csv` (n=43). Direct user-research evidence; quote verbatim with attribution.
4. `docs/m4/**` - existing drafts of all three documents. Treat them as a baseline to improve and re-ground, not as gospel.
5. The codebase, `ARCHITECTURE.md`, and `CLAUDE.md` for product facts. The `package.json` files (root, `apps/*`, `packages/*`) for the dependency-and-license inventory.

## Ground rules

- Evidence over assertion. Every design claim traces to a real quote, survey figure, git commit, or Linear/Trello item. Attribute interviewee quotes by name (for example Tom Carvell, Luca Morgan).
- Team versus participants. The four team members are Gong, Lukas, Noah, and James (see the timeline roster). Luca Morgan, Tom Carvell, Zack Foreman, Felicity Turner, Fangyi Lin, Will Groves, Thomas Gonzalez, Nathan, and Matthew are interviewees or usability-test users. Never list them as team members.
- Integrity on metrics. Moderated usability metrics (SUS, task-success rate, time-on-task, and product telemetry) were never collected. Do not fabricate them. Where a number is required but uncollected, write `[TEAM TO FILL]`, and label any illustrative figure as illustrative in the sentence.
- Known data gap. The Luke interview transcript exported empty and is lost. Do not invent its content.
- Product facts. The product is BeThere. The model is the unified suggest flow: one creator sends one plan to a group; a plan owns a TIME candidate list and an ACTIVITY candidate list; members add to and publicly +1 either list during `collecting`; vote counts are public but no voter names are ever shown (creator anonymity is always on); the two creator flags are `lockTimes` and `lockActivity`; a plan moves `collecting -> moment -> cleared`. A plan's name is its activity; there is no separate title.

## Deliverable 1 - hcd-portfolio.md (80%)

Cover, all grounded in the evidence above: the problem statement and the "how might we" question; personas built from the survey and interviews; a stakeholder map; the HCD research methods chosen and why; current-state versus future-state user journeys; a service blueprint; the prototyping fidelity ladder (paper and M2 mockups through to the interactive build); a finding-to-change traceability matrix (user finding to design response to where it shipped, sourced from the Trello cards and the timeline); an impact analysis; and a short, honest reflection on the team's process.

## Deliverable 2 - pitch-leaflet.md (10%)

A single page: product name, a one-line value proposition, the explicit target audience, the problem statement and "how might we", a before-versus-after contrast, the core flow in three or four steps, and a research-grounded footer (cite the survey n=43 and one key interview insight). Keep to one page of content.

## Deliverable 3 - copyright-legal-report.md (10%)

One side: inventory BeThere's third-party dependencies against their licenses (read the `package.json` files); give a permissive-versus-copyleft tally; discuss notice and attribution duties (including the Apache `NOTICE` duty and font OFL attribution); cover the commercial terms of the hosted services (Clerk for auth, plus hosting on Vercel and AWS); and address UK GDPR and personal-data handling for the app. Where a license is uncertain, flag it to verify rather than guessing.

## Formatting - keep it minimal

- Plain Markdown only. No emoji, no decorative dividers, no bold-spam. Use headings, short paragraphs, and simple tables only where they genuinely aid reading.
- Write in a plain, direct voice. No marketing fluff and no AI throat-clearing ("In today's fast-paced world...").
- Three separate files. Do not merge them.

## Process

1. Read the sources listed above before writing anything.
2. For each document, draft a tight outline mapped to its rubric, then write the document.
3. Self-check before finishing: is every claim evidenced; is any metric fabricated; is any team member confused with a participant; is the formatting minimal. Fix issues, then output the three files.
