# BeThere - M4 Deliverables

This folder holds the **BeThere** submission for the **DRP M4: More Iterative Development** review, including the **Project Documentation portfolio (20% of the module mark)**. BeThere is a group meetup-coordination app (Expo React Native mobile client + Fastify/tRPC/Postgres backend) that turns a vague "we should hang out" into a firm plan with no organiser and no public "maybe". The documents below are grounded in the team's real primary research (a 43-response survey collected 19 to 20 May 2026 and seven interviews across two rounds), the unified-suggest-flow codebase, and the project's Linear + git history (around 395 commits, 50 Linear issues). Together they cover the review's assessed rows: the Project Pitch Leaflet, the Copyright/Legal Issues Report, and the Human Centred Design Techniques Portfolio, plus supporting impact and evaluation assets.

## What is in this folder

| File | What it is / what it is for | Rubric row it satisfies |
| --- | --- | --- |
| `DESIGN_LANGUAGE.md` | The reusable visual brand kit and design prompt for BeThere: refined-neobrutalist aesthetic, lavender-to-blush gradient canvas, palette, type (Archivo + Inter), shape, shadow and voice rules. Read this first if you are editing or re-rendering any HTML asset, so everything stays on-brand. | Shared brand reference (underpins the leaflet and cover story; not separately graded) |
| `pitch-leaflet.html` | A single-A4 marketing leaflet: product name, hero value proposition, explicit target-audience line, the problem statement and "how might we" question, a before/after strip, the four-step flow, a phone mock-up, and a research-grounded footer. Print-ready HTML/CSS. | **Project Pitch Leaflet (10%)** |
| `copyright-legal-report.md` | A one-side copyright and legal report inventorying every BeThere third-party dependency against its licence, with a permissive-only / no-copyleft headline tally, a Mermaid licence-family diagram, and a discussion of notice retention, the Apache `NOTICE` duty, font (OFL) attribution, Clerk/hosting commercial terms, and UK GDPR. | **Copyright/Legal Issues Report (10%)** |
| `hcd-portfolio.md` | The main portfolio: personas and stakeholder map, the verified survey/interview research, current-versus-future user journeys, a code-accurate service blueprint, a fidelity-ladder prototyping section with the authentic M2 mockups, a finding-to-change traceability matrix, an impact analysis, an embedded cover story, and an honest reflection. | **Human Centred Design Techniques Portfolio (80%)** |
| `cover-story.html` | A speculative "The Gathering" 2028 magazine cover story about BeThere's wider positive impact, on-brand and print-ready, with hedged evidence-led claims, a before/during/after micro-diagram, four cover lines (including the honest Felicity tension), and a clear speculative-versus-real disclaimer. | M4 impact asset / cover story (supports the portfolio's impact section) |
| `quantitative-evaluation.md` | The M4 objective-evaluation document: the problem anchored in the real survey (n=43, re-tallied), a four-family product-metric framework with the full System Usability Scale (SUS) instrument, an across-iterations comparison (timeline + DRP-ID step table), and a runnable moderated-usability protocol. All uncollected numbers are marked `[TEAM TO FILL]`; illustrative figures are labelled in-sentence. | M4 quantitative evaluation (objective evidence for the portfolio) |

## How to export for submission

- The **`.html` files** (`pitch-leaflet.html`, `cover-story.html`) are print-ready. Open each in a browser, choose **Print**, set the destination to **Save as PDF**, paper size **A4**, margins **Default** (or **None** if a margin pushes content onto a second page), and **enable "Background graphics"** so the gradient, borders, and hard shadows render. Each is designed to fit **exactly one A4 page** - check the print preview shows a single page before exporting.
- The **`.md` files** (`copyright-legal-report.md`, `hcd-portfolio.md`, `quantitative-evaluation.md`) can be submitted as Markdown, or rendered to PDF via your Markdown viewer / VS Code print-to-PDF / Pandoc. Their **Mermaid diagrams** require a renderer that supports Mermaid (GitHub preview, VS Code Mermaid extension, or `mermaid-cli`); confirm the diagrams render before exporting.
- Font note for the HTML assets: Archivo and Inter load from Google Fonts, which **needs a network connection at export time**. If you export offline, either embed/subset the fonts or accept the Arial Black / system-ui fallback.

## TEAM MUST DO BEFORE SUBMITTING

These artifacts are **AI-drafted from the team's real research and codebase**. Read every one and edit it into the team's own voice before submission - do not submit them unread. The specific real-world actions and placeholders still outstanding:

### Run the quantitative instruments (this is the big one)
- [ ] **Run the moderated-usability protocol in `quantitative-evaluation.md` Section 5 with 5 to 8 target users.** Use it to fill **every `[TEAM TO FILL]` cell** in the Section 4.3 scorecard: SUS mean, SUS grade, task-success rate, time-on-task, confusion-event count, and the S1/S2 supplement cells. They are all currently empty placeholders - **do not present any of these as a measured result until you have actually collected them.**
- [ ] **Instrument family-D product-outcome telemetry** on the staging or live deployment - plan clear rate, fizzle rate, RSVP completion, conditional-RSVP usage, anonymous-creation share, time-to-lock, and votes per plan. None of this logging exists yet.
- [ ] **Confirm the shipped state of the change-RSVP-after-lock feature** (Tom's request) and fill that cell in the Section 4.2 table.
- [ ] The same `[TEAM TO FILL]` metrics (meetup conversion rate, organiser-burden self-report, fizzle rate, SUS / task-completion) feed `hcd-portfolio.md`. Once collected, update the portfolio too - and never present them as measured there until they are.

### Screenshots and visuals
- [ ] **Capture 2 to 3 screenshots of the running build** (the create wizard, the `collecting` EventDetail with public vote counts, and a cleared "You're in" moment) and embed them in `hcd-portfolio.md` Section 5.2, next to the hand-drawn M2 sketches, to complete the concept-to-build visual ladder.
- [ ] **Optionally swap the illustrative CSS phone mock-up in `pitch-leaflet.html`** (Sunday Lot, Pizza & catch-up, vote counts) for a real product screenshot.

### Print and layout checks
- [ ] **Print-preview `pitch-leaflet.html` to PDF at A4 and confirm it stays on exactly one page.** If it spills, trim the `.page` gap (5mm) or the hero padding.
- [ ] **Print-preview `cover-story.html` to PDF at A4 and confirm it is a single page.**
- [ ] Confirm Archivo + Inter load (network available) at export time, or accept the documented fallback.

### Legal and content sign-off
- [ ] **Confirm any licence the report marks "verify".** In particular, verify the exact licence text shipped in `node_modules` at release time (the report's closing summary advises this), and confirm the approximate MIT dependency count if you want a precise figure in the Mermaid licence-family pie (the "30" is an approximate grouping label, not a measured count).
- [ ] **Ensure `quantitative-evaluation.md` holds the exact survey counts** that back the leaflet footer's "dominant responses to uncertainty" claim, so the two documents agree.
