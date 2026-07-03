# Myo Control Centre Architecture Specification
**Version:** Control-centre architecture release spec (final)  
**Audience:** Tom (operator)  
**File:** `docs/CONTROL_CENTRE_ARCHITECTURE_SPEC.md`  
**Build constraints respected:** Node 20 + Express, `better-sqlite3`, no frontend build step, vanilla ESM in browser.

---

## 1) The 3 signature features

### 1.1 Interrupt Budget Gauge + auto-gating (tom-centric)
- **One-line description:** A live “how full is Tom’s interruption day?” meter that auto-defers low-urgency asks when capacity is exceeded.  
- **Data source:** `myo-engagement/queue.json`, dispatcher events (`myo-engagement/dispatcher.jsonl`), plus `data/state.json` for Tom’s configurable daily cap.
- **Why removing it makes this generic Kanban:** Without this, every card needing a reply becomes the same friction as any other lane item. Tom stays hostage to every edge case. The budget meter is what makes this an operating cockpit, not a board; it turns workflow noise into controlled decision policy.
- **What it looks like in UI:** A ring gauge in the right rail/pane, with color bands:
  - green: low ask pressure
  - amber: “batch, don’t page” warning
  - red: budget exceeded, defer non-emergency asks automatically.  
  A quick counter shows open Tom-actions, and +/- controls (or `/cap N`) allow Tom to change threshold without opening code.

**Tom outcome:** You see whether to keep interrupting yourself right now, or intentionally push non-critical items to your evening digest.

---

### 1.2 Trust Ledger with per-send gate chips
- **One-line description:** Every outbound send is displayed as a trust transaction with explicit gates (`ALW`, `CNS`, `DRY`, `HZL`) and a short “why this passed/failed” rationale.
- **Data source:** `myo-engagement/audit.jsonl` (send attempts), `myo-engagement/dispatcher.jsonl` (dispatch decision), `myo-engagement/queue.json` (send context), and `data/state.json` (manual verification actions).
- **Why removing it makes this generic Kanban:** Without the ledger, this is just “cards + reminders.” With it, Tom gets governance visibility into *why* each outbound action happened and whether safety gates were honored. That is how this becomes an auditable operating system, not just a status list.
- **What it looks like in UI:** A compact right-panel table or strip:
  - timestamp
  - recipient/route
  - card reference
  - gate chips colored pass/fail/open
  - one-click “Verify”/“Re-check” action for any row.  

**Tom outcome:** You can answer “Did we send this right?” in seconds while maintaining the hard stop policy on trust-sensitive actions.

---

### 1.3 Specialist Mood Cards (trusty humans at a glance)
- **One-line description:** Live mini-profile cards for Hannah/Holly/Hazel/Henry with state, current task, and likely next decision window.
- **Data source:** `kanban.db` (`task_runs`, `assignee`, `worker_pid`) plus board task status for context and `state.json` for “owner override” flags.
- **Why removing it makes this generic Kanban:** Without real-time specialist mood, the system looks like static ticket tracking. With it, Tom can understand *who* is actually working vs waiting vs blocked, which is the core difference between a control plane and a passive card list.
- **What it looks like in UI:** A “who’s doing what” panel with cards showing:
  - specialist avatar/name
  - state (working / reviewing / waiting / idle)
  - current task and ETA text
  - tiny recent activity log (last 3 events)

**Tom outcome:** You can decide if an interruption is avoidable because “Tom would be duplicating specialist work” instead of asking blindly.

---

## 2) Full feature set (8–12)

| # | Feature | What it is (one line) | Data source | UI element |
|---|---|---|---|---|
| 1 | Interrupt Budget Gauge | Shows current Tom interruption pressure and automatically soft-blocks low-priority asks when full | `queue.json`, `dispatcher.jsonl`, `state.json` | **Right pane panel + top status chip** |
| 2 | Trust Ledger | Per-send safety card with pass/fail gate chips for every outbound action | `audit.jsonl`, `dispatcher.jsonl`, `queue.json`, `state.json` | **Right pane panel / list row chips** |
| 3 | Specialist Mood Cards | Current state of workers (working/reviewing/waiting/idle), with latest task context | `kanban.db` (`task_runs`, `worker_pid`) + `board.db` task status | **Main panel cards in overview row** |
| 4 | Needs Tom queue | Prioritised “Tom action required” cards with one-tap responses, threaded links, and optional defer actions | `board.db` + `audit.jsonl` + `state.json` | **Right pane cards + inline actions** |
| 5 | Curated studio lanes | Focused 4-5 lane operational board (Triage/Ready/In Progress/Blocked/Done) for daily execution decisions | `board.db` (`cards`, `sections`, route events) | **Main content panel (multi-lane board)** |
| 6 | Timeline feed | A 7-day/24h digest of card events + sends + crons for incident traceability | `board.db` events + `dispatcher.jsonl` + `audit.jsonl` | **Timeline view (strip/list)** |
| 7 | Live activity stream | Real-time rolling stream with filter by send/cron/block/done | `queue.json`, `dispatcher.jsonl`, `audit.jsonl` | **Live view stream panel with filters** |
| 8 | People/CRM-lite | Card-level list of real contacts and synthetic personas from Obsidian vault context with open thread state | `Obsidian/People` markdown frontmatter + `conversations.db` | **People view grid** |
| 9 | Route trust states | Fast route-level status (real/synthetic/consent-pending) with policy chips and actionability labels | `board.db` + `auditor/audit` + route config | **Right pane “Routes” panel** |
| 10 | Command palette + slash commands | Fast jump/actions for Tom: open card, dispatch specialist, pause loop, adjust cap, open timeline | Existing routes + local command registry | **Overlay drawer (⌘K / Ctrl+K) + keyboard map** |

**Supporting but not signature items to ship behind these**: compare drawer, interruption heatmap, board embed fallback, weekly retro auto-primer, and compact KPI strip.

---

## 3) Navigation / IA model

### Chosen model: **Rail-first hybrid** (left side rail + top command bar + slash overlay)
This is the primary recommendation because Tom needs fast, reliable orientation under load:

- **Left rail (primary):** fixed one-click entry to Control, Board, People, Timeline, Live. It keeps deep context in your hands without forcing menu hunting.  
- **Top bar (secondary):** shows page context, global refresh, live system status, and a single search field. This is where Tom sees “what am I operating right now?” at a glance.  
- **Command palette (tertiary):** `⌘K` as escape hatch for power operators when speed matters (e.g., `/dispatch`, `/pause`, `/cap 4`, jump to card).  

### Why not top-tabs only?
Tabs are good for broad categories but weak on operational memory. Tom does repeated ops in a live run where the same 5 views recur; a side rail preserves spatial familiarity even when he is context switching while cards are changing.

### Why not command-first only?
Fast for experts, but expensive for incident triage when Tom wants instant visual context and doesn’t want to remember all commands. Rail-first preserves accessibility without removing power-user flow.

---

## 4) What to build tonight / this week / aspirational

### Tonight (1–2 features, ~2 hours, Tom-visible)
Realistic first milestone for a no-build-step stack: ship a high-value, visible cockpit in one pass.

1. **Interrupt Budget Gauge (minimal)**
   - Add right-pane budget ring + counter.
   - Derive current pending asks from existing queue/dispatch signals.
   - Implement cap adjuster buttons and `/cap N` parsing.
   - Result: Tom immediately sees whether to keep the loop engaged or route low priority asks into digest.

2. **Needs Tom lane in Control view**
   - Create a dedicated “Needs Tom” block in the right pane.
   - Pull cards/events that require manual intervention.
   - Add one-tap actions: `View`, `Resolve`, `Defer`.
   - Result: Tom has immediate value on first run, not just a pretty panel.

*Optional if UI styling is already in place:* add one route trust chip panel with 3 entries (real/synthetic/consent-pending).

### This week (full signature-3 + 2–3 supporting)

#### Deliver the three signature features as a coherent operator cockpit:
- **Interrupt Budget Gauge** with threshold states and overflow policy.
- **Trust Ledger** with gate chips + manual verification action.
- **Specialist Mood Cards** with live-ish recency and simple status mapping.

#### Add 2–3 supporting features to complete the operator loop:
- **Needs Tom queue** with one-tap resolution and card link actions.
- **Command palette + slash commands** for Tom-speed actions (pause/resume loop, focus card, dispatch worker).
- **Route trust state strip** for quick triage of real-vs-synthetic boundaries.

### Aspirational (long-tail / design-heavy)
This set improves depth and narrative control but needs more validation and copy/interaction polish before release:

1. **Interruption Heatmap** — weekly 2-hour block demand map to tune interrupt policy and batch windows.
2. **Compare Drawer** — side-by-side draft-vs-review diff for blocked/controversial items (e.g., policy disputes like dedupe window).
3. **Full timeline + deep activity correlation** — event timeline that ties card transitions, specialist activity, and audit evidence.
4. **Embedded board view with full fidelity** — keep Trello-like workflow in control-centre, not replace it, with a safe fallback when embedding is unreliable.
5. **Automated weekly summary generator** from trust/interrupt/flow metrics.

---

## 5) Data model additions

### Guiding constraint
- **Do not mutate `board.db`** as source of truth for source entities.
- Use existing read-only DBs/JSON as source signals.
- Store Control Centre derived state in **writable app data**, not inside immutable core DB files.

### Recommended storage additions

1. **`data/control-centre/state.json` (or extend `data/state.json`)**  
   - Purpose: Tom-facing control knobs + last-seen state + preferences.
   - Add fields:
     - `interruptBudget`: `{ capPerDay, pendingCount, exceededSince, autoDeferMode, resetPolicy }`
     - `ui`: selected rail view, sort/filter defaults.
     - `commands`: recent slash actions for simple recovery and traceability.

2. **`data/control-centre/control_center_projection.db` (better-sqlite3 optional) or JSON equivalent**  
   - Purpose: fast reads for UI panels without repeatedly parsing huge logs.
   - Suggested tables (if SQLite):
     - `interrupt_daily_counts(date TEXT, two_hour_block INTEGER, ask_count INTEGER)`
     - `needs_tom_queue(card_id TEXT, first_seen_at DATETIME, priority INTEGER, due_by DATETIME, summary TEXT, status TEXT)`
     - `route_trust_state(route TEXT, trust_tier TEXT, last_update_at DATETIME, issue_count INTEGER)`
     - `specialist_mood_snapshot(assignee TEXT, state TEXT, task_id TEXT, last_heartbeat DATETIME, current_activity TEXT, eta_minutes INTEGER)`
     - `trust_ledger_snapshot(event_id TEXT, sent_at DATETIME, route TEXT, to_address TEXT, subject TEXT, gate_alw INTEGER, gate_cns INTEGER, gate_dry INTEGER, gate_hzl INTEGER, verify_status TEXT, action_source TEXT)`
   - Suggested JSON alternative: same structures persisted as NDJSON for append/read simplicity.

3. **Derived projection over `myo-engagement/audit.jsonl`**  
   - Build an in-memory / persisted trust ledger view per send event:
     - parse outbound records
     - map to 4 core gates (ALW/CNS/DRY/HZL)
     - compute verification timestamps and actor (`Tom`, `Henry`, `auto`) for each.

4. **`task_run` → specialist mood derivation layer**  
   - New endpoint/service query: “latest run per assignee.”
   - No schema change needed in `kanban.db`; create derived list by:
     - selecting latest `task_runs` per assignee,
     - enriching with board assignment from `board.db` and state flags (running/review/blocked).

5. **Needs-Tom and compare snapshot projection**  
   - Add an append-only `data/control-centre/compare_snapshots.jsonl` or `compare_snapshots` table:
     - `card_id`, `variant` (`draft`, `review`, `resolved`), `content`, `reviewer`, `created_at`.
   - Supports the future compare drawer without inventing a heavy VCS dependency.

6. **Heatmap materialization**  
   - Add optional `interrupt_heatmap_daily.json` or table keyed by `date` + `2-hour block`: this is just analytics cache, not source-of-truth.

7. **Health snapshot row**  
   - Extend projection with a tiny health row (`cron_ok_count`, `queue_depth`, `specialist_busy_count`, `board_sync_seconds`) to feed top status chips without hitting all sources on every render.

---

## 6) The ONE thing Tom is missing in the brief

### Missing question:
**What is the hard policy for the interruption triage ladder under overload?**

Specifically: **which classes of asks are allowed to break the daily interrupt cap without manual confirmation** (e.g., compliance failures, hard blockers, live prospect follow-up, and cron safety escalations), and what is the automatic timeout for each escalation path?

If Tom defines this rule once, everything else in Control Centre becomes deterministic. If he does not, no UI redesign will solve “too many false emergencies.”

---

## 7) What to build tonight — concrete next moves (Tom-only decisions)

### Move 1: Freeze the policy before UI work (10 minutes)
- Set the default interruption cap (recommend **5/day** to start).
- Define 3 escalation tiers:
  1) Blocker must alert Tom immediately, 2) Operational questions can wait for batch window, 3) Non-urgent reminders are deferred.
- Confirm whether synthetic route failures can ever break the cap.

### Move 2: Lock safety semantics for trust gates (15 minutes)
- Confirm gate definitions and minimum required states for **every outbound real-world send**:
  - allowlist required
  - consent recorded
  - dry-run parity
  - Hazel review required where applicable
- Define “verified” conditions and who can mark verification.

### Move 3: Approve the minimal data surface for v1 (5 minutes)
- Confirm these must-render fields for every lane/update card:
  - `card_id`, `owner`, `status`, `last event`, `needs Tom?`, `risk`.
- Confirm these people columns:
  - `Holly`, `Hazel`, `Henry`, `Hannah` (and whether future specialists are auto-indexed).
- Confirm one source for real-time specialist state (prefer `kanban.db.task_runs` + worker heartbeat heuristic).


---

## Summary for implementation kickoff
If you want this shipped in the same architecture style as the rest of Myo, the above spec gives an operator-first Control Centre with three hard differentiators:
- interruption control,
- trust evidence,
- and specialist state.

Everything else is additive and can be staged without blocking live work.
