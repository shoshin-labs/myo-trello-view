# Myo Control Centre — One-pager

*Drafted 2026-07-02 in response to Tom's "who are we / what are we doing / focus for self-improvement" question. Living doc — lives alongside the Trello view source so it ships with the app.*

---

## Who we are (one sentence)

**Myo is a small, focused consultancy that diagnoses one charity workflow at a time and ships a Hermes-enabled operating model that the charity can actually run.**

That's it. Everything else is in service of that sentence.

## What we actually do

Five things, in order of how often they happen:

1. **Diagnose a workflow** — talk to the charity, find the actual friction (not the AI-shaped one), write a one-page memo.
2. **Design the operating model** — what the human does, what Henry does, where the gates are, what gets logged.
3. **Build the bounded Hermes implementation** — agents, prompts, allowlists, dispatchers, audit trail. Single workflow, single tenant.
4. **Harden governance** — Hazel-style review on every public-facing artifact, consent capture, opt-in records, kill-switches.
5. **Run one pilot** — keep it small, keep it named, keep it reviewable.

## What we are explicitly NOT

This is the half that matters. Without it, the sentence above drifts.

- **Not an AI transformation programme.** No "we'll revolutionise your charity with AI." Ever.
- **Not a multi-agent theatre shop.** The Hannah/Holly/Hazel model is *internal plumbing*, not the product.
- **Not a generic SaaS tool.** We don't ship a product; we ship an operating model inside one charity.
- **Not autonomous high-risk actions.** Every outbound email, every public artifact, every spend decision is human-gated.
- **Not a free-pilot shop.** Sam's ArtHouse route is paid engagement, not charity.
- **Not a case-study factory.** No "we helped Client X achieve Y" claims until the client has approved them in writing.

## What we're working on right now (the north star)

**MYO-70 — Head of Development starter pack, anchored on the ArtHouse / Sam route.** Five deliverables planned, one shipped (the grant-pipeline readout). Sam follow-up sent 12 min before this doc was written; awaiting reply. The point of MYO-70 is to prove the offer: one charity, one workflow, one usable pack.

## Where our self-improvement focus goes (next 30 days)

This is the "what we are improving" half. Three durable targets, in priority order:

### 1. Mechanism, not symptoms

We keep finding gaps where the *plumbing* is broken but the *output* still looks fine for a while, then quietly fails. The Henry Operating Principles doc (8 lessons, all with paired scripts/tests) is the inventory; **MYO-85 — ship the 6 unbuilt guardrails** is the project. The point: every principle needs a load-bearing check, not a note.

**Specific durable changes queued in MYO-85:**
- Pre-send body-read check (Sam principle 1)
- Held-to-Discord 1-minute tick (principle 2)
- Card-completeness safety net (principle 3) — script exists, test missing
- Verify-send against Resend API (principle 6)
- Three more to be specified

### 2. The auto-dispatch gap (MYO-83)

Real, named, written-down gap: when Hazel returns BLOCK WITH REQUIRED FIXES to a Holly assignee, **no Holly worker picks up the follow-up**. We found this when MYO-82 sat pending for 10 hours tonight. The board.db and kanban.db are correct; the bridge between them is broken. Fix this and the human-gate overhead drops by ~30%.

### 3. The control centre itself (this conversation)

Trello → control centre. See the architecture spec at `docs/CONTROL_CENTRE_SPEC.md` (forthcoming tonight from the Claude architecture delegation). The honest pitch is: **we don't currently have one place where Tom can see everything that's true about Myo right now.** That's a self-improvement problem, not a vanity UI problem.

## What we measure

Three numbers, no more:

- **Time from a Tom-decision-needs-answer inbound to a usable card on `#henry-needs-answers`**: target ≤ 60s. Currently varies; specific incident on 2026-07-01 (Sam inbound) was hours.
- **Hazel block → auto-reopened fix task**: target ≤ 5 min. Currently: never (MYO-83).
- **Closed cards per week that actually advance the north star**: target ≥ 2. Currently: ~1 (MYO-70-D1 done, D2-D6 parked).

If those three numbers move, Myo is improving. If they don't, we're busy.

## What we don't do (the discipline half)

- No simultaneous engagement routes without distinct consent records (Sam vs Dean vs generic MYO-73).
- No real charity/funder/applicant data without explicit Tom clearance on the route.
- No public proof, case study, or pricing claim without Hazel approval of the exact wording.
- No auto-replies, follow-ups after silence, or "polite chase" patterns without Tom's gate.
- No editing the live system files instead of the repo (sync.sh is the only deploy path).

## The shortest honest version

We are Myo. We diagnose one workflow, build one Hermes operating model, harden it with one gate pattern, run one pilot, and we are deliberately small. Right now we are working on **MYO-70** (the starter pack via ArtHouse), and our **self-improvement focus is mechanism-level** — shipping the durable guardrails behind the principles, fixing the auto-dispatch gap, and building the control centre so Tom can see everything that's true about Myo at a glance.

That's the answer to "do we have a clear idea of who we are."