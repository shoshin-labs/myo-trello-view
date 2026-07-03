# Control Centre as an actual app — stack and operating choices

Date: 2026-07-03  
Audience: Tom, as operator  
Scope: research recommendation only; no code changes.

## Objective

Turn the Myo Control Centre from a useful Tailscale-only prototype into a small real app without turning it into a platform. The important constraint is not technical novelty. It is preserving the Myo operating shape: one workflow, one tenant, deliberately small, gates-not-promises, and one-tap human decisions.

The current app already has the right centre of gravity: Node 20, Express 4, `better-sqlite3`, vanilla browser ESM, no build step, served on the Hermes host over Tailscale. It reads `board.db`, derives operator views, writes local scratch state into `data/state.json`, and now has a small action surface for agent status, Henry chat, spawn, and card-thread lookup. The question is whether to keep stretching that shape or move to a more formal app stack.

My short answer: keep the current stack for the next real pilot, add a small app-state store beside it, and put the first serious boundary around auth, persistence, and phone usefulness. Do not migrate to a framework because it is more respectable. That would be very on-brand for software, and therefore suspect.

## Current-state summary

The app is currently a single-tenant operator cockpit:

- `board.db` remains the read-only board source by convention.
- `data/state.json` holds writable UI/state edits.
- `/api/agents/status` reads `kanban.db` read-only and maps Hannah/Holly/Hazel/Henry into live-ish states.
- `/api/chat/henry` and `/api/chat/henry/poll` use JSONL inbox/outbox files and per-message logs.
- `/api/spawn` creates Kanban tasks through Hermes.
- `/api/threads/:card_id` combines board events, Henry chat, and engagement audit tail data.
- Fable v2 polls agent status every 15 seconds and long-polls Henry chat replies.

The planned architecture already points toward an operator cockpit, not a generic dashboard: interruption budget, trust ledger, specialist mood cards, Needs Tom queue, studio lanes, live activity, people/CRM-lite, route trust chips, and command palette. Most of those are projections over local Myo/Hermes state, not general SaaS features.

## Key constraints and assumptions

Assumptions I am making:

- First real usage is 1–3 humans, one charity pilot, one Myo workflow.
- Tom still wants Tailscale/private-first unless there is a clear reason to expose it.
- The board source remains read-only: the app may project, cache, annotate, and spawn work, but should not mutate `board.db` directly.
- App state can be local to the Hermes host for now if it is backed up and auditable.
- Idle infrastructure above roughly $20/month is a smell at this stage.

Constraints that matter more than elegance:

- Keep the source-of-truth boundary obvious.
- Avoid scattering app state across five services.
- Keep first-user time short.
- Make phone access useful, not just technically possible.
- Make every outward action auditable and gated.

## Stack options

| Option | Ergonomics | Cost at real scale | Time to first real user | `board.db` fit | Multi-device story |
|---|---|---:|---|---|---|
| Current Node + Express + SQLite + vanilla ESM | Best fit today. Small, legible, no build step, matches current code. | Tailscale host already paid for; effectively $0 incremental. | Fastest: days, not weeks. | Excellent: `better-sqlite3` reads local DB directly. | Good enough once responsive UI and Tailscale phone path are fixed. |
| Next.js | Familiar ecosystem, but introduces framework, build, routing conventions, and deployment opinions. | Vercel/Node hosting can be low initially, but not free once always-on backend/state enters. | Slower: migration before product value. | Awkward for local SQLite unless self-hosted; serverless and local files are a poor marriage. | Strong web/PWA story, but paid for with complexity. |
| SvelteKit | Lighter than Next, pleasant UI ergonomics. | Similar: cheap on adapters, but backend/state still needs hosting. | Moderate; would require a rewrite of the front-end surface. | Fine only if self-hosted Node; less direct on edge/serverless. | Good responsive/PWA story. |
| Remix / React Router framework | Good data-loading model, solid web-app structure. | Similar to SvelteKit/Next depending host. | Moderate-to-slow for this app. | Fine when self-hosted; awkward if pushed to serverless. | Good, but not uniquely useful here. |
| Astro | Excellent content/static site tool; less natural for live app actions. | Very cheap for static content. | Quick for docs, slower for cockpit actions. | Poor for local live SQLite unless paired with a separate API. | Good static/PWA, weak cockpit fit alone. |
| Cloudflare Workers + D1 | Strong for public edge app, low cost. Workers Paid starts around $5/month; D1 free/paid limits are generous for this scale. | Low: $0–$5/month initially; scales cheaply. | Slow if preserving current local-state semantics. | Weak unless `board.db` is replicated/exported into D1. D1 is not “read local board.db”. | Excellent public/mobile reach once auth is solved. |
| Static SPA + BaaS: Supabase / PocketBase / Convex | Fast for generic apps, auth and data included. | Supabase/Convex can be cheap at low scale; PocketBase self-hosted is cheap. | Moderate. You still design the data boundary. | Usually bad: encourages copying board state into a new source of truth. PocketBase local is closest, but still another app DB. | Strong if public/mobile-first. |
| Tauri wrapper around existing app | Useful for desktop packaging, not necessary for Tom. | Low once built, but build/distribution overhead. | Slower than improving the web app. | Good if it simply wraps local web surface. | Poor for phone; solves the wrong device first. |
| Native shell | Best device integration in theory, highest build burden. | Developer time cost dominates; hosting unaffected. | Slowest. | Requires API abstraction anyway. | Strong phone UX if built, but not worth it now. |

The practical conclusion: a framework migration only pays if the app is becoming a multi-user product surface or needs a large UI team. It is not there. For the next pilot, the current stack gives Tom the shortest path to a real cockpit with the fewest hidden dependencies.

## Persistence diagnosis

There are three kinds of state, and they should not be blurred:

1. Source state: `board.db`, `kanban.db`, `myo-engagement/`, Obsidian project notes, conversation logs. These are owned by their native systems. The Control Centre reads them.
2. Projection state: cached views for speed and UI stability: specialist mood snapshot, Needs Tom queue, trust ledger projection, thread cache, route state, timeline summary.
3. App state: Tom’s preferences and actions: selected view, interrupt cap, dismissed cards, manual verification marks, chat session index, spawn history, phone display preferences.

I would add one small Control Centre app-state store under the existing app, not a new managed database. Either:

- `data/control-centre/app.db` using SQLite, or
- `data/control-centre/*.jsonl` for append-only logs plus a compact `state.json`.

SQLite is better once we have chat history, spawn logs, verification marks, and thread cache. JSONL remains useful for append-only audit trails. The split I would use:

- `app.db`: sessions, users/devices if needed, preferences, cached thread summaries, current projections.
- `audit.jsonl`: append-only Control Centre actions: chat sent, spawn requested, verification clicked, cap changed.
- continue reading source files in place; never copy `board.db` wholesale unless it is explicitly a snapshot/projection.

Chat history should be shared at first, because the system is an operator cockpit, not a private messaging product. If later there are charity-side users, split into per-user/session views then. Spawn log should be shared and append-only. Agent mood snapshot is a derived cache from `kanban.db`, not user-owned. Thread cache is shared and invalidatable.

## Auth options

Today’s “Tailscale and no app auth” is coherent for one trusted operator. Tomorrow’s choices:

- Stay Tailscale-only: lowest friction, smallest public surface, best for Tom phone + laptop. It blocks ordinary charity users unless they join Tailnet or use a shared device path.
- Magic link: familiar and light, good for 1–3 external users, but requires email plumbing and a public endpoint.
- OIDC with Google/Apple: good if external users are expected, but introduces provider configuration and account edge cases.
- Passkeys/WebAuthn: excellent security, too much ceremony for the next pilot unless the app is public and high-trust.
- Reverse proxy with mTLS: strong but too fiddly for charity-side humans.
- Cloudflare Access: very good middle ground if going beyond Tailscale. It gives identity-aware access, Google/OTP options, logs, and keeps app auth out of the prototype code. It does require Cloudflare routing and a public-ish hostname.

Recommendation: keep Tailscale-only for Tom/Henry/Hannah/Holly/Hazel usage. If one charity-side pilot user needs access, use Cloudflare Access in front of the existing app before building app-native auth.

## Hosting options

- Tailscale-only box/status quo: best for the next real engagement. It keeps local SQLite/state access simple and costs nothing extra.
- Self-hosted with Tailscale Serve/Funnel: Serve is good for private tailnet ergonomics. Funnel/public exposure should trigger a proper auth decision.
- Cloudflare Pages + Workers: strong if the app becomes public or mostly static with an API. Workers Paid is roughly $5/month with generous included usage; D1 free/paid limits are enough for this scale. But it forces a replication decision for local SQLite sources.
- Fly.io: good for running the current Node app with a persistent volume; tiny shared machines can be single-digit dollars per month, with 1GB shared machines around mid-single digits plus storage. Operationally reasonable.
- Railway: easy deploys, usage-based, Hobby starts around $5/month including usage credits. Good developer experience, but persistent local SQLite and source-file access need volumes/secrets discipline.
- Render: simple web service hosting; free/static is cheap, paid always-on starts around $7/month for small services. Persistent disk is extra. Fine, not special.
- Netlify: excellent for static/front-end, less natural for this local SQLite cockpit unless paired with a separate backend.

For Tom’s expected scale, “host the thing where the state already lives” wins. Moving hosting first creates a data movement problem before there is a user problem.

## Multi-device: what changes first

For Tom opening the panel on his phone, the first useful changes are not native apps:

Ship first:

- Make the Fable layout phone-responsive: collapse right pane into a bottom sheet, make Needs Tom the first phone view, make cards thumb-sized and one-tap.
- Add a PWA manifest/icon so it can live on the home screen.
- Keep Tailscale mobile access working and document the URL.
- Add “read now / decide now / defer” actions that require no keyboard.
- Persist UI state per device: last view, compact mode, dismissed panels.

Defer:

- Native shell.
- Offline mode.
- CRDT collaboration.
- Public charity login.
- Full board editing on phone.

Phone value is seeing whether Tom is needed and giving one-tap responses. It is not recreating the desktop board on a small rectangle, a punishment technology has tried many times.

## Real-time updates

Current polling every ~15 seconds is acceptable for specialist status. Options:

- Keep polling: simplest, cheap, predictable. Fit: excellent for 1–3 users.
- Server-Sent Events: good next step for live activity and status streams. Simpler than WebSockets, works well from Express, low overhead.
- WebSockets: useful for two-way collaboration/chat presence. Overkill for current needs; more lifecycle handling.
- Cloudflare SSE/Workers streams: good if hosted on Cloudflare, not a reason to move by itself.
- CRDT with Yjs/Automerge: only if multiple humans are editing the same content concurrently. Bad fit now; complexity would swamp the workflow.
- No real-time: acceptable for static board/docs, weak for control centre. The cockpit should feel alive, but does not need millisecond truth.

Default: keep polling for status, use long-poll/SSE for Henry chat and live activity when the UI needs it. Do not introduce WebSockets or CRDTs until there is actual multi-human concurrent editing.

## Alignment with Myo principles

Preserves Myo:

- Current stack + local app-state DB: one workflow, one tenant, direct state boundary.
- Tailscale-only: deliberately small, minimum surface area.
- Cloudflare Access in front of existing app: acceptable when one external access path is needed.
- SSE/polling: simple enough to audit.
- App-state beside source state: gates and human decisions stay visible.

Risks breaking Myo:

- Next/Svelte/Remix migration before user pressure: stack theatre.
- Supabase/Convex as the new centre of gravity: data scatter and source-of-truth drift.
- D1 migration without a clear replication rule: `board.db` stops being the obvious source.
- Native app now: solves distribution before workflow.
- CRDTs now: collaboration architecture without collaborators.

## Recommended paths

### Path A — Keep current stack, harden into a real private app

Keep Node/Express/SQLite/vanilla ESM. Add `data/control-centre/app.db`, append-only audit JSONL, PWA basics, phone-responsive layout, and either polling or SSE. Stay Tailscale-only. This is the fastest, cheapest, and most aligned path.

Trade-off: less fashionable, fewer built-in framework conveniences. Also known as “not making the work worse.”

### Path B — Current app plus Cloudflare Access when one external user appears

Keep the same app and host, but put a Cloudflare Access-protected hostname in front when a real charity-side user needs to see a limited surface. Do not build app-native auth first. Split views so external users see only the pilot-safe subset.

Trade-off: introduces Cloudflare routing/configuration, but avoids a full auth system.

### Path C — Fly.io/Railway/Render only if the app must leave the Hermes host

Containerise the existing Node app with a persistent volume and environment-mounted state paths or replicated snapshots. Use this only if Tailscale/private host access becomes operationally awkward.

Trade-off: cleaner external deployment, worse local-state simplicity.

## Recommended default

Default to Path A: keep the current Node + Express + SQLite + vanilla ESM stack and harden it into a private app. Add a small Control Centre app-state SQLite DB beside the existing `data/` folder, keep `board.db` read-only, and use JSONL for audit events that Tom or Hazel may need to inspect. Keep hosting on the Tailscale-only Hermes box for the first real pilot; improve phone usefulness via responsive layout, PWA affordances, and one-tap Needs Tom actions. Revisit Cloudflare Access only when an actual external human needs access.

## Constraints I would accept

- Fine if it stays 1–3 users for the next pilot.
- Fine if the app is Tailscale-only for Tom/Henry/operator use.
- Fine if real-time means polling/SSE rather than WebSockets.
- Fine if app-native auth is deferred.
- Fine if the Control Centre has one local app-state DB, provided source DBs stay read-only.
- Fine if the first phone version is a focused operator surface, not the whole desktop app.

## Constraints I would reject

- Would not accept a framework migration just to look like a “real app.”
- Would not accept losing the read-only-on-`board.db` principle.
- Would not accept scattering state across Supabase/Convex/D1/local JSON without a declared ownership model.
- Would not accept idle backend costs above about $20/month for the first pilot.
- Would not accept public exposure without Tailscale, Cloudflare Access, or equivalent access control.
- Would not accept native mobile as the first route to phone usefulness.

## Sources checked

- `/var/lib/hermes-agent/work/myo-trello-view/README.md`
- `/var/lib/hermes-agent/work/myo-trello-view/src/server.js`
- `/var/lib/hermes-agent/work/myo-trello-view/docs/CONTROL_CENTRE_FABLE_LIVE.html`
- `/var/lib/hermes-agent/work/myo-trello-view/docs/CONTROL_CENTRE_ARCHITECTURE_SPEC.md`
- `/var/lib/hermes-agent/obsidian-memory/Projects/Myo.md`
- Cloudflare Workers pricing docs: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare D1 limits docs: https://developers.cloudflare.com/d1/platform/limits
- Fly.io pricing docs: https://fly.io/docs/about/pricing/
- Railway pricing: https://railway.com/pricing
- Render pricing: https://render.com/pricing
