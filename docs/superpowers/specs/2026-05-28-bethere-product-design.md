# BeThere — Product Design

**Date:** 2026-05-28
**Status:** Design agreed in a prototyping session; this is the product spec to implement on the `drp_02` skeleton.
**Companion doc:** `2026-05-28-bethere-reference-implementation.md` (stack-matched reference code: Zod schemas, Drizzle tables, tRPC routers, pure logic, RN screens, style tokens).
**Origin:** Concept developed against the brief in `~/Programming/Projects/DRP/mock/PRD.md` and refined in a design session (visual mockups live in that repo under `.superpowers/brainstorm/`). This doc supersedes that PRD — the model has changed substantially (see §2).

> `drp_02` is described in `CLAUDE.md` as "a group meetup-coordination app … currently a skeleton, no product/domain logic yet." **BeThere is that product.** The monorepo-skeleton spec explicitly deferred "availability, groups, proposals, responses, push, AI suggestions" — i.e. exactly the domain logic specified here.

---

## 1. One-line concept

BeThere turns a vague "we should hang out" into a firm plan with **no organiser and no public "maybe."** People privately share *when they're free*; when enough overlap, the app fires a single concrete proposal to exactly those people on a short timer, and they answer **Yes / No / "I'm in if…"** — blind. Nobody is ever seen wanting something that didn't happen.

## 2. How this evolved from the PRD (read before implementing)

The PRD proposed a one-stage "private conditional-commitment clearinghouse": drop an *intent* (activity + window + circle) → silent match → reveal at a fixed quorum of 3. We kept the privacy thesis but **restructured into two stages** to fix the PRD's biggest hole (a feedback-less dead waiting room) and sharpen the "maybe" solution:

| PRD | BeThere | Why |
|---|---|---|
| One "intent" = activity + window + circle dropped into the void | **Stage 1: availability** (when you're free), separate from **Stage 2: commitment** (Yes to a concrete plan) | "When you're free" is a *fact*, not a *desire* — it exposes nothing, so it's psychologically free to give. The want is only ever expressed as a one-tap Yes to an already-validated plan. |
| Silent floating until quorum, then reveal | A **BeReal-style synchronised, timed proposal** ("the moment") | The countdown is the feedback loop the PRD lacked; it forces resolution *before* the doubt window opens (Matthew) and gives urgency without a dead wait. |
| "Maybe" made safe by invisibility | **No Maybe. Yes / No / Conditional** ("I'm in if [people]") with **all / at-least-one** modes | The conditional replaces the asymmetric "maybe" with a structured signal the *system resolves*. It is also Matthew's social-proof lever, declared privately. |
| No organiser at all | **No organiser *labor*** — a one-tap light suggestion seeds a round; if a group's gone quiet, the **AI** seeds one from past meetups | A light "dinner?" nudge is the easy part people already do; we remove the hard part (chasing, scheduling, deciding) and backstop even the nudge. |
| Quorum default 3 | **Auto** — smallest viable group for the activity | Matches "smaller is easier" (84% of survey); zero config. |

The product name also changed: **BeThere** (was the placeholder "Quorum").

## 3. Personas (design *for* these two)

- **Luca — the Resigned Waiter.** Wants to see people but assumes it won't happen; never initiates ("usually just let it happen"); sends "maybe" as a polite hedge. **Needs:** express real willingness at zero social risk, drive nothing, escape silently.
- **Matthew — the Deliberator.** Follows the crowd; his "maybe" = optionality; **delay is fatal** to him; flips toward *going* on social proof. **Needs:** speed (resolve before doubt) and social proof at the moment of decision.

## 4. Inviolable principles

1. **Privacy-first.** Availability is never visible to anyone — no names, no counts, ever.
2. **"When" ≠ "want."** Availability is a neutral fact given freely; desire is expressed only as a Yes to a concrete, already-matched plan.
3. **Blind & equal at the moment.** During the response window nobody sees how others answered. The *one* exception is the linchpin nudge (§7).
4. **No public "no."** Non-response, "no," withdrawal, and non-clearing are all silent and indistinguishable. Failure costs nothing and is seen by no one.
5. **No organiser labor.** The system coordinates; a suggestion is one tap; the AI seeds when no one will.
6. **Speed beats precision.** Loose availability, instant matching, a short timed moment.
7. **No enforcement, no pressure mechanics.** No deposits, staking, penalties, attendance scoring, or guilt.
8. **Costs less than the problem.** Irritation at failed plans is only mild (2.31/5), so the tool must be near-frictionless: sub-10-second availability, zero config, minimal copy, restrained UI.

## 5. The loop (happy path + branches)

```
Someone lightly suggests (activity + loose window)        ┌─ (alt) group dormant → AI seeds a suggestion from past meetups
        │                                                 │
        ▼                                                 ▼
  Notify group: "X suggested 🍜 — when are you free?"  ◄───┘
        │
        ▼
  Each person drops loose availability  ── PRIVATE (server never reveals who/what)
        │
        ▼
  Silent matching: a concrete slot where ≥ auto-quorum are free
        │
        ▼
  THE MOMENT — notify exactly those people, on a countdown:
  "Dinner tonight? Pho House · Thu 7pm"   Yes / No / I'm in if…   (BLIND)
        │                                          │
        ▼ (buzzer)                                 └─ a linchpin may get ONE quiet nudge
  Resolve conditionals; |IN| ≥ quorum?
        ├─ yes → IT'S ON: "you + N others are in" → firm plan + add to calendar
        └─ no  → SILENT FIZZLE: it just fades. No notification, no trace.

  (any time before the buzzer: withdraw quietly — no one notified)
```

## 6. Screens & states

Mobile (Expo RN). One primary action per screen. Voice: warm, low-pressure, reassuring about invisibility — the opposite of a nagging group chat. Each screen notes the research finding it answers (the HCD crit grades this traceability).

### 6.1 Home / Groups
- Your **groups** (you can be in several) as calm rows. A single primary **"Suggest something."** A live moment shows a gentle banner; otherwise the screen is quiet by design.
- *Trace:* multi-group; calm default (anti-chat).

### 6.2 Suggest (the seed)
- Activity chips: ☕ Coffee · 🍜 Food · 🏋️ Gym · 📚 Study · 🍻 Drinks · ✨ Anything (+ optional free text).
- Loose window chips: Tonight · This week · Weekend · Pick a range. **No time grid.**
- Pick the group. Submit → *"Sent to Flatmates. We'll ping everyone to add when they're free."*
- *Trace:* only 9% organise → suggesting is one tap, not organising.

### 6.3 Availability (private)
- *"Maya suggested 🍜 Food — when are you free?"* Pick loose availability: day chips (within the window) + time-of-day (Morning / Afternoon / Evening). No precise grid.
- Persistent reassurance: **"Private — only you see this. No one knows unless it clicks."**
- Submit → floating.
- *Trace:* 86% hedge/silent + "maybe" asymmetry → the entry is a *fact*, not a *want*; fully private.

### 6.4 Floating (the calm wait)
- Your live availability as calm items. Status: **Floating**. **No counts, no names, nothing to refresh.**
- **Withdraw quietly** — one tap, no confirmation drama, no one notified.
- *Trace:* a partial count would re-leak the asymmetry → kept abstract; silent escape hatch (Luca; 56% have lied to dodge plans — here there's nothing to dodge).

### 6.5 The moment (the heart — blind & timed)
- Header: group name + **quiet countdown** ("4:58 left"), no badge.
- Headline (Lora): the proposal, e.g. *"Dinner tonight?"*
- **Plan card:** activity, concrete time, place, a small detail (e.g. "8 min walk").
- Three responses: **I'm in** (primary) · **I'm in if…** (secondary) · **Can't make it** (quiet text).
- **"I'm in if…"** opens a bottom sheet: a segmented toggle **All of these / At least one**, then a multi-select of group members. Copy: *"Pick who you're waiting on. They'll never know — if they come, you're in automatically."* → **Done.**
- Blind: no other responses or counts are shown.
- *Trace:* delay-decay → the timed moment resolves before doubt; no Maybe; conditional = structured hedge; blind = genuine, un-herded commitments (supports the 74% don't-flake finding).

### 6.6 It's on (the reveal)
- Headline (Lora): *"It clicked."* Subtitle: *"You're not the only one who wanted this."*
- **Social proof:** avatar cluster + **"You + N others are in."** Everyone shown opted in — that's why it's safe to reveal them.
- Plan card. Primary: **Add to calendar.** Secondary: **Suggest a tweak** (light, single-round — not a thread).
- *Trace:* social proof at the moment of decision (Matthew); reveal only the IN crowd (no public no).

### 6.7 Firm plan (it's happening)
- Compact card: activity, final time, place, confirmed people. **Add to calendar + reminder** prompted (both personas forget). Deliberately minimal — no thread.
- *Trace:* 74% don't flake post-firm → the job is reaching the plan, not policing it.

### 6.8 Silent expiry (must be representable)
- If the window passes without quorum, the floating item simply **fades**. **No notification, no "your plan failed," no trace.** This non-event is the thesis made visible.
- *Trace:* failure must be costless and invisible (irritation 2.31; 56% dodge) — here there is nothing to dodge or explain.

## 7. Matching, conditional resolution & the linchpin nudge

Precise behaviour (reference implementations in the companion doc, §"Pure logic core"):

- **Availability** = a person + loose slots `(day, partOfDay)` within the suggestion window.
- **Concrete slot → time:** morning→10:00, afternoon→14:00, evening→19:00 (heuristic; tune later).
- **Auto-quorum** (smallest viable): coffee 2 · study 2 · gym 2 · food 3 · drinks 3 · anything 2.
- **Trigger:** find a concrete slot `t` where `Pₜ = {people free at t}` has `|Pₜ| ≥ quorum(activity)`. If several qualify, pick the one maximising `|Pₜ|` (tie-break earliest). Create the **moment** with `proposedTime = t`, `participants = Pₜ`, then start the countdown. **No intransitivity bug:** everyone in `Pₜ` is free at the *same* slot, so they're mutually compatible by construction — we select people who share a slot, never a "connected component" that might have no common time.
- **Responses:** `yes` · `no` · `conditional { mode: "all" | "any", targetIds }`.
- **Resolve at the buzzer:**
  1. `IN = { everyone who said yes }`.
  2. Repeat to a fixpoint: for each unresolved conditional `p` — if `mode="all"` and `targets ⊆ IN`, add `p`; if `mode="any"` and `targets ∩ IN ≠ ∅`, add `p`.
  3. Conditionals need a real `yes` to latch onto; **pure conditional cycles never enter `IN`** (prevents phantom plans nobody actually wanted).
  4. **Clear** if `|IN| ≥ quorum` → create the plan with `confirmedParticipants = IN`; else **silent fizzle**.
- **Linchpin nudge (the one exception to blind/equal):** during the window, `p` is a *linchpin* if they haven't said yes and adding them to `IN` would, after resolving conditionals, reach quorum (or unlock others that do). Send `p` **one** nudge: *"A couple of people are in if you are — want to join?"* Guardrails: **anonymous** (no names), **vague** (never a number), **positive** (never "you're holding it up"), **single** (no nagging), **silently ignorable** (decline and no one ever knows you were pivotal or that you passed).

## 8. Privacy invariants (the spine — the server MUST enforce these)

1. Availability is never returned to anyone but its owner — no names, no counts.
2. During a moment's window, no participant can read others' responses or any tally.
3. Only exception: the single linchpin nudge (anonymous, vague, positive, ignorable).
4. At resolution only the **IN** crowd is revealed; No's and non-responders are invisible and indistinguishable.
5. Non-clearing **fizzles silently** — no notification, no trace, nobody learns how close it got.
6. **The complete list of outbound notifications:** (a) "X suggested … add your availability"; (b) the moment ("it's coming together — respond"); (c) the one linchpin nudge; (d) the firm-plan reminder. **Nothing else ever notifies.**

> Because `drp_02` is client/server, these are **server-authoritative** rules: tRPC procedures must shape their return types so a malicious or curious client literally cannot fetch pending availability or in-flight responses. See the companion doc for procedure-by-procedure notes.

## 9. Non-goals (evidence-driven scoping wins — state these in the crit)

- **No deposits / staking / penalties / attendance scoring** (74% don't flake post-firm — enforcement solves a non-problem).
- **No full group chat** (we replace the dragged-out thread, not reproduce it).
- **No precise calendar grid / availability spreadsheet** (loose by design — speed over precision).
- **No public visibility of pending availability, ever** — not even counts.
- **No "Maybe" button** (replaced by the conditional).
- **No live tally during the moment** (blind/equal).

## 10. Research traceability (n=43 survey + 4 interviews)

| Finding | Figure | → Design decision |
|---|---|---|
| Hangouts ghost | 53% have ≥30% ghost | The whole product: reach firm plans before they evaporate |
| Hedge/silent when unsure | 86% "maybe"/nothing; 9% clear yes | No Maybe; availability-as-fact entry; blind responses |
| Would use a private signal ≥ group chat | 80% (47% *more*) | **Headline validation** — private availability, invisible until it clicks |
| Larger group easier? | 0% yes (84% smaller) | Auto-quorum = smallest viable group |
| Lied/excused to dodge a meetup | 56% | Silent withdraw + silent fizzle — nothing to dodge |
| Initial time agreed without change | 24% | Instant silent matching; one concrete proposal; no public negotiation |
| See themselves as organiser | 9% | No organiser labor; one-tap suggest; AI seeds when dormant |
| Bail on already-firm plan | 74% rarely/never | No enforcement; effort spent *reaching* the plan; blind = genuine commitments |
| Irritation when plans fail | 2.31/5 | Tool must cost less than the pain → sub-10s, zero-config, minimal UI |
| Social proof flips Matthew | interview | Reveal "you + N others"; conditional as private social proof; linchpin nudge |

## 11. Visual identity (full tokens in the companion doc)

- **Palette (Sage):** bg `#F7F8F3` · surface `#FFFFFF` · ink `#1F2823` · muted `#8B948B` · **accent `#5F9472`** · accent-ink `#3F7355` · accent-soft `#E9F1EB` · line `#E9ECE5`.
- **Type:** **Lora** (~600) for headlines/display; **Inter** (400/500/600/700) for body and UI.
- **Aesthetic (hard-won in review):** flat — **no gratuitous gradients, no decorative badges, no glow shadows**; **one accent**, used only for the primary action and selection; hairline borders; generous whitespace; **minimal copy** (screens don't explain themselves). Calm and intentional, never "vibe-coded."
- Reference mockups for the look: `~/Programming/Projects/DRP/mock/.superpowers/brainstorm/90637-1779962750/content/final-style.html` (and `moment-v2.html`).

## 12. Open / deferred (defaults chosen; adjust when implementing)

- **AI seeding:** the suggestion text is generated from group history. Start **stubbed** (a deterministic "you usually get coffee — again?" from `lastMetAt` + past activities); wire a real model later behind the same procedure.
- **Push notifications:** the design assumes push (the only 4 signals in §8.6). Implement later with `expo-notifications`; until then, simulate in-app (poll on focus). **Real-time is push-based by design — no websockets needed.**
- **Window length, auto-quorum numbers, time-of-day → concrete time:** heuristics above; tunable.
- **Calendar integration:** "Add to calendar" can use `expo-calendar` later; a prompt/stub is fine first.
- **Navigation library:** none in the skeleton yet — see companion doc for the recommendation.
