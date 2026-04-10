# Hackathon Call Copilot UI — MVP Concept

**Scope**: Frontend-only MVP for the AI Call Copilot demo at Open Mercato Hackathon 2026 (Track 3: Showcase, Sopot, 10–12 April).
**Owner**: Rafał (Sub-Spec B of `HACKATHON-MASTER-SPEC.md`).
**Related**: `.ai/specs/HACKATHON-MASTER-SPEC.md` (shared contracts in §1, source in §3), `.ai/specs/2026-04-07-hackathon-sub-spec-b-copilot-ui.md` (full spec).

---

## TLDR

A single full-screen page at `/backend/voice-calls/copilot` that shows a **live call transcript on the left** and a **prioritized AI suggestion stack on the right**, driven by four SSE events from the voice_channels orchestrator. During the 90-second stage demo the page turns a fake inbound sales call into a live stream of Polish transcript bubbles plus 5 types of contextual Copilot cards (product, pricing, customer context, deal status, quick actions) — with intent toasts and transcript-segment glow effects tying suggestions back to what the customer just said. The UI is fully standalone: it can run against real backend events OR against a locally-imported demo script JSON so the frontend can be built in complete isolation from Sub-Specs A and C.

---

## Demo Goal

A ~90-second on-stage flow:

1. Presenter opens `/backend/voice-calls/copilot`.
2. Clicks **Start Demo Call** → call header turns blue, pulsing green dot appears, timer starts.
3. Polish transcript lines stream in (rep ↔ customer bubbles, auto-scroll).
4. Within ~400 ms of a customer utterance, an **intent toast** flashes (“Detected: product_need”), then a **card slides in** from the right (e.g. ProductSuggestion with 3 matching SKUs + live stock + price).
5. The triggering transcript segment **glows yellow** for 4 s so the audience visually links cause → effect.
6. Presenter clicks **+ Dodaj do oferty** on a product row → button animates into **✓ Dodano do oferty**.
7. More customer speech triggers PricingAlert, CustomerContext, DealStatus, QuickAction cards in sequence. Presenter dismisses a card with ✕.
8. Presenter clicks **End Call** → header dims, final segment/suggestion counts shown in footer.

The demo succeeds if the audience perceives: *the copilot is listening, understanding, and helping in real time*.

---

## MVP Scope (In)

- Single full-screen page `/backend/voice-calls/copilot` (not injected into the existing shell; own layout).
- **Live transcript feed**: auto-scroll, speaker color bands (Handlowiec blue / Klient purple), timestamp per segment, fade-in animation.
- **Suggestion stack**: max 5 cards visible, priority-sorted (high → medium → low), recency tiebreak, 60 s dedup window per card `type`.
- **5 card types**, each visually distinct via colored left border + header tint:
  - `ProductSuggestion` (blue, 📦)
  - `PricingAlert` (amber, 💰)
  - `CustomerContext` (violet, 👤)
  - `DealStatus` (cyan, 📊)
  - `QuickAction` (green, ⚡)
- **Call header**: pulsing green live dot, customer name + company, phone number, direction, tabular-num elapsed timer.
- **Copilot ON/OFF toggle**: client-side gate that silently ignores new `voice_channels.copilot.suggestion` events when OFF.
- **Start/Stop demo buttons** hitting `POST /api/voice_channels/mock/start` and `POST /api/voice_channels/mock/stop` via `apiCall`.
- **Wow moments**:
  - Intent toast (1.2 s amber flash) rendered *before* the card slides in.
  - Transcript glow (4 s `highlightPulse`) on the segment matched by `suggestion.triggerSegmentId`.
  - Optimistic **Added to quote** state on `ProductCard`.
  - Pulsing green live indicator on header.
  - Confidence badge colored green ≥80 / yellow <80.
- **Empty states** in Polish (“Oczekiwanie na transkrypcję…”, “AI Copilot nasłuchuje rozmowy…”).
- **Standalone fallback**: `?mock=local` query param replays the imported `demo-1-acme-steel.json` via `setTimeout` directly into local state, bypassing the SSE bridge — lets Rafał develop without backend.

## MVP Scope (Out)

- Real telephony integration (Twilio/Asterisk/etc.).
- Call history, persistence, recording playback.
- Authentication flows beyond an RBAC feature guard (`voice_channels.copilot.view`).
- Any backend code (orchestrator, intent detector, MCP tools, seed data) — owned by Sub-Specs A and C.
- Analytics, reporting, aggregation.
- Mobile / tablet layouts. Target is 1920×1080 projector.
- Dark mode.
- i18n beyond Polish. Strings are hard-coded PL for the demo.
- Real CRUD hooks on `+ Dodaj do oferty` — purely visual.

---

## User Flow (7 steps)

1. **Page load** → RBAC guard `voice_channels.copilot.view` passes; keyframes injected; empty states render.
2. **Start Demo Call** → `POST /mock/start` with `demoScript` body. Backend emits `voice_channels.call.started`.
3. **Call started event** → `callActive=true`, header goes blue, timer begins, panels clear.
4. **Segments stream** → each `voice_channels.call.transcript_segment` appends to `segments[]`, auto-scrolls, renders with speaker style.
5. **Suggestion event** → if `copilotEnabled`: intent toast flashes (1.2 s), `triggerSegmentId` pulsed in transcript (4 s), card slide-in animation, dedup + sort + slice(5).
6. **Interaction** → presenter dismisses a card (✕) or clicks a quick action / add-to-quote (optimistic visual only).
7. **End Call** → `POST /mock/stop`, backend emits `voice_channels.call.ended`, header dims, footer shows `N segments · M suggestions`.

---

## Success Criteria

- [ ] Page renders at `/backend/voice-calls/copilot` with no console errors.
- [ ] Works at 1920×1080 without horizontal scrollbars.
- [ ] All 5 card types render with distinct styling and correct field formatting.
- [ ] p95 UI latency from event receipt to card visible < 300 ms.
- [ ] TranscriptFeed auto-scrolls on new segments (smooth behavior).
- [ ] Highlighted segment visually pulses when a suggestion with matching `triggerSegmentId` arrives.
- [ ] Dismiss (✕) removes the card immediately from the stack.
- [ ] Copilot OFF blocks new suggestions (existing cards untouched).
- [ ] Timer shows tabular-num elapsed time while call is active, freezes on call ended.
- [ ] `?mock=local` mode works with zero backend dependency.
- [ ] Polish empty-state text visible before any events.

---

## Dependencies

| Dep | Source | Type | Criticality |
|---|---|---|---|
| Shared types | `packages/voice-channels/src/modules/voice_channels/types.ts` | Compile-time import | Hard |
| 4 frozen event IDs | `HACKATHON-MASTER-SPEC.md` §1.5 | Runtime contract | Hard |
| `POST /api/voice_channels/mock/{start,stop}` | Sub-Spec A | Runtime HTTP | Soft (fallback: `?mock=local`) |
| `demo-1-acme-steel.json` demo script | Sub-Spec C, `data/demo-scripts/` | Build-time asset | Hard (needed for standalone dev AND real demo) |
| `useAppEvent` hook | `@open-mercato/ui/backend/injection/useAppEvent` | Compile-time | Hard |
| `apiCall` helper | `@open-mercato/ui/backend/utils/apiCall` | Compile-time | Hard |

No dependency on Sub-Spec A or Sub-Spec C internals beyond the shared contract surface.

---

## Risks (MVP-specific)

| Risk | Mitigation |
|---|---|
| SSE bridge not live when demo starts | `?mock=local` replays demo JSON locally; verified daily during build. |
| LLM suggestion latency > 3 s | Handled upstream by orchestrator's dual-track (fast keywords + smart LLM); frontend shows intent toast immediately. |
| Confidence badge misread as AI accuracy | Label says `% match` not `accuracy`. |
| Inline styles drift from design system | Scoped to this demo page only; explicitly documented exception. |
| Card spam | 60 s dedup per `type` + top-5 slice. |
| Missing demo JSON file at build | Commit a placeholder `demo-1-acme-steel.json` with the `MockCallScript` shape; Sub-Spec C overwrites later. |

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Package scaffold (`@open-mercato/voice-channels`) | Done | 2026-04-07 | package.json + tsconfig + build.mjs + watch.mjs, turbo-ready. |
| Shared types (§1.1 of master spec) | Done | 2026-04-07 | `src/modules/voice_channels/types.ts`. |
| Module entry + `acl.ts` + `setup.ts` | Done | 2026-04-07 | Feature `voice_channels.copilot.view`, default role features. |
| Copilot page + components + 5 card types | Done | 2026-04-07 | `backend/voice-calls/copilot/page.tsx` + `components/copilot/*`. Sub-components live outside `backend/` so the backend page scanner does not treat them as routes. |
| Demo script `demo-1-acme-steel.json` | Done | 2026-04-07 | 10 segments, PL, inbound B2B steel sales call (ACME Steel). |
| Synthetic suggestions (`demo-suggestions.ts`) | Done | 2026-04-07 | All 5 card types keyed to segmentIds 2/4/6/8/10. |
| Standalone local replay | Done | 2026-04-07 | `Start Demo Call` dispatches `om:event` window CustomEvents; zero backend dependency. Replaces the `?mock=local` fallback — always on for the hackathon demo. |
| Register in `apps/mercato` | Done | 2026-04-07 | `modules.ts` + `apps/mercato/package.json` workspace dep; `mercato generate` picks it up. |
| Mercato generators | Done | 2026-04-07 | Page registered as `/backend/voice-calls/copilot`, shows in "Voice Channels" nav group. |

---

## How to Run It

### Prerequisites
- Working Open Mercato dev environment (DB up, `yarn install` done).
- A user account with the `voice_channels.copilot.view` feature. After pulling this change run `yarn initialize -- --reinstall` (or re-run tenant setup) so the new feature is assigned to `superadmin`/`admin`/`employee` per `packages/voice-channels/src/modules/voice_channels/setup.ts`. Alternatively, grant it manually in the Roles admin.

### First-time setup (one command)
```bash
yarn install
yarn workspace @open-mercato/voice-channels build
yarn workspace @open-mercato/app generate
yarn dev
```

### Open the Copilot
1. Log in to `/backend`.
2. Navigate to **Voice Channels → Call Copilot** in the sidebar, or go directly to:
   ```
   http://localhost:3000/backend/voice-calls/copilot
   ```
3. You should see the dark call header (“Brak aktywnego połączenia”), an empty transcript on the left (“Oczekiwanie na transkrypcję...”), and an empty suggestion stack on the right (“AI Copilot nasłuchuje rozmowy...”).

### Run the demo
1. Click the blue **▶ Start Demo Call** button in the footer.
2. The header turns blue, a green dot starts pulsing, and the elapsed timer (00:00, 00:01, …) starts counting.
3. Polish transcript bubbles stream in automatically. Around specific lines (segments 2/4/6/8/10) an **amber intent toast** flashes, the corresponding transcript bubble **glows yellow**, and a new suggestion **card slides in** from the right.
4. You can interact during the call:
   - Click **+ Dodaj do oferty** on a product → button animates into **✓ Dodano do oferty**.
   - Click the **✕** in any card header → the card disappears from the stack.
   - Flip the **Copilot ON/OFF** pill → new incoming suggestions are silently ignored while OFF.
5. Click **■ End Call** at any time to end early, or wait for the script to finish; the header dims and the footer shows the final segment / suggestion counts.

### Reset between takes
Just click **▶ Start Demo Call** again. It clears all state and replays from the top. No DB writes, no backend state, no cleanup.

### Projector tips (1920×1080)
- Put the browser in fullscreen (F11) and zoom once (Cmd/Ctrl + "+") for maximum readability from the back row.
- Make sure the browser window is on the projector output *before* clicking Start — the replay has real timers, so you do not want the first 20 seconds to happen on your laptop screen.

### Troubleshooting
- **403 / redirect to login** → your user does not have `voice_channels.copilot.view`. Run `yarn workspace @open-mercato/app initialize --reinstall` or grant the feature manually.
- **Blank page / "Module not found"** → re-run `yarn workspace @open-mercato/voice-channels build` then `yarn workspace @open-mercato/app generate`.
- **Cards don't slide in** → the ON/OFF toggle is probably OFF. Flip it back to ON.
- **Nothing happens on Start** → open devtools; the page dispatches `om:event` CustomEvents on `window`. If you see them fire but the UI doesn't react, the `useAppEvent` hook failed to mount (hard reload).

---

## 5-Minute Stage Demo Script — "The ACME Steel Save"

Designed for maximum **WOW effect** at the Sopot Hackathon 2026 Track 3 Showcase. Total runtime: ~4:30 on the clock + 30 s buffer for applause. You are the storyteller — the UI does the talking.

> **Setting**: You are Anna Kowalska, senior sales rep at a Polish steel distributor. It's Tuesday 10:47 AM. Your best customer, ACME Steel, calls in angry. You have 90 seconds to not lose a half-million-złoty account. Your only superpower: an AI Copilot listening in the background.

### 0:00–0:30 — The hook (talk-only, screen on empty Copilot)

> "How many of you have ever been on a sales call where the customer asked a question, and you had to say 'give me a second, I'll check and call you back'? [pause] That second is where deals die. Today I want to show you what happens when that second *never has to exist*."

Click into the browser. The page is already open. Point at the dark header, the empty transcript, the empty stack.

> "This is our new Call Copilot. It listens to the call in real time, detects intent, and surfaces exactly what the sales rep needs — products, prices, customer history, open deals, next actions — *before they even finish typing a search*. No tab switching. No alt-tabbing to the ERP. Let me show you."

### 0:30–1:00 — The call starts (WOW #1: customer context)

Click **▶ Start Demo Call**.

Point at the header: **"Live call. ACME Steel. Marek Nowakowski. 00:03."**

Segments 1–2 stream in (Anna greets, Marek introduces himself).

On segment 2 the **customer context card slides in from the right**.

> "Look — the moment Marek said his name, the Copilot already pulled his full CRM profile: 1.24 million PLN lifetime value, 47 orders, last one three weeks ago, top categories. I didn't click anything. It's just *there*."

Tap the notes line: "Kluczowy klient — negocjator, oczekuje rabatów wolumenowych."

> "And it's already warning me: 'Key account. Negotiator. Expects volume discounts.' That's the coaching I wish I'd had in my first year."

### 1:00–2:00 — Product match (WOW #2: transcript glow + product card)

Segments 3–4 play. Marek says: *"Potrzebujemy pilnie 200 sztuk profili stalowych 80x80..."*

The moment segment 4 lands:
1. An **amber toast flashes**: "Wykryto intencję: zapotrzebowanie na produkt".
2. The transcript line **glows yellow for 4 seconds**.
3. A **Product Suggestion card slides in** with 94% match, two SKUs, live stock (412 szt., 180 szt.), prices in green.

> "Three things just happened simultaneously. [point at toast] The Copilot detected the intent *before* it finished speaking. [point at yellow glow] It shows me *exactly which sentence* it reacted to — so I know why. [point at card] And it already gave me two matching SKUs with live stock from the warehouse, prices, and a recommendation: use the S355 for load-bearing."

Click **+ Dodaj do oferty** on the first product. The button flips to **✓ Dodano do oferty**.

> "One click. Product is in the draft quote. I still haven't stopped listening to the customer."

### 2:00–3:00 — The objection (WOW #3: pricing guardrails)

Segment 6 lands: *"...musicie zejść z ceną."* Amber toast flashes. Pricing Alert card slides in.

> "Here's the moment every rookie rep crumbles: the price objection. Junior rep panics, gives away 15%, destroys the margin. Watch what the Copilot does."

Tap the three columns on the Pricing card:

> "**Customer price**: 189.90. **Floor**: 171.00 — *this is the lowest I'm allowed to go*, set by finance. **Max discount**: 10%. And down here — two *active* promotions I can stack: volume -6%, VIP Q2 -3%. I can give him -9% right now, stay above the floor, close the deal, and I didn't need to phone my manager."

### 3:00–3:45 — The complaint + deal status (WOW #4: proactive awareness)

Segment 8: *"A przy okazji — jak wygląda nasza ostatnia reklamacja?"*

Deal Status card slides in showing two open deals, including one marked **⚠ Wstrzymany** (stalled, pulsing red).

> "Marek just sandbagged me with a second topic — his open complaint. In the old world, I'd say 'let me check and get back to you.' In this world, the Copilot *already knows*: there's a stalled 184,500 PLN deal that's been sitting in negotiation for 12 days. That's the real reason he's frustrated. Now I have the context to fix it *on this call*."

### 3:45–4:15 — The close (WOW #5: one-click action)

Segment 10 lands: *"...bierzemy od razu 200 sztuk i dołożymy zamówienie na blachy."*

Quick Action card slides in with three green buttons.

> "And this — this is the magic moment. The Copilot heard the purchase intent and pre-built my next three actions: **create the quote with the -6% discount already applied**, **schedule a follow-up for tomorrow 9 AM**, **add a note to CRM**. One. Click. Each."

Hover over "Utwórz ofertę z rabatem -6%" but don't click — let the audience imagine it.

> "In a real call, I'm clicking that button *while Marek is still talking*, and by the time he hangs up, the quote PDF is already in his inbox."

Click **■ End Call**. Header dims. Footer: *"10 segments · 5 suggestions"*.

### 4:15–4:30 — The landing

Point at the stack of five colored cards.

> "Five pieces of contextual intelligence. Zero tab switches. Zero 'let me call you back.' That's what we built in 48 hours at this hackathon. Thank you."

[applause, bow, exit stage left]

---

### Delivery tips (internal, not spoken)

- **Practice the timer**: the script replay is 35 seconds end-to-end. Your narration has to track it. Rehearse twice before going on stage.
- **Don't read the transcript out loud** — the audience can read Polish too. Point and narrate *what's happening above the transcript*: the cards, the glow, the toasts.
- **Own the silence when a card slides in.** Let the animation land. One second of visual drama beats five seconds of talking.
- **If the replay finishes before you do**: click Start Demo Call again and keep narrating. Nobody will notice the restart — it's the same story.
- **Backup plan**: if the browser crashes, refresh and hit Start again. Zero state, zero setup, 3 seconds to recover.
- **Biggest applause line**: "One click. Product is in the draft quote. I still haven't stopped listening to the customer." Pause for effect.

---

## Changelog

- **2026-04-07** — Initial MVP concept doc extracted from `HACKATHON-MASTER-SPEC.md` §3 for standalone Sub-Spec B execution.
- **2026-04-07** — Implementation: `@open-mercato/voice-channels` package scaffolded, page + 9 components + demo script + synthetic suggestions delivered, registered in `apps/mercato`, `mercato generate` green. Added "How to Run It" and 5-minute stage demo script ("The ACME Steel Save").
