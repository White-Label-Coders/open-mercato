# Copilot Quick Actions: Plan Follow-up & Add Note

## TLDR
**Key Points:**
- Wire the two unconnected QuickActionCard buttons (`schedule_followup`, `add_note`) in the Voice Channel Copilot to real CommandBus operations
- After a call ends, the sales rep can: (1) schedule a follow-up interaction with AI-suggested date/description via an editable dialog, (2) add an AI-generated conversation summary as a CRM note via a popup editor
- AI prefill data (summary + follow-up suggestion) is pre-computed at call end and embedded in the QuickActionCard's `prefill` payload — zero latency on button click

**Scope:**
- `schedule_followup` → opens dialog pre-filled with AI-suggested date, title, and description → creates a **Task** (`CustomerInteraction` with `interactionType: 'task'`, `status: 'planned'`) via `customers.interactions.create` → appears in the **Tasks tab** of the customer detail (People/Companies)
- `add_note` → opens popup editor pre-filled with AI-generated conversation summary → creates a **Note** (`CustomerComment`) via `customers.comments.create` → appears in the **Notes tab** of the customer detail
- Call linkage via `source` field: `voice_channels.copilot:{callId}` on tasks (no core schema changes needed)
- AI generation at call end via Claude API (same pattern as `mergeCompanyContext`)
- Both actions self-assigned to the current sales rep

**Concerns:**
- Claude API availability at call end — generation is best-effort; fallback to raw transcript excerpt

## Overview

When a Voice Channel Copilot call ends, the orchestrator emits a final QuickActionCard with three buttons. The "Create offer" action is handled separately. This spec covers the remaining two:

1. **Plan a follow-up** — The rep clicks the button, a dialog opens with AI-suggested follow-up date (next business day morning), title, and description derived from the conversation. The rep can edit all fields, then confirm to create a planned interaction linked to the call.

2. **Add a note** — The rep clicks the button, a popup opens with an AI-generated conversation summary. The rep reviews/edits, then saves to create a CRM note (comment) on the customer entity.

Both actions use the existing CommandBus infrastructure (`customers.interactions.create` and `customers.comments.create`), ensuring full undo/audit/event support.

> **Market Reference**: Studied HubSpot's post-call workflow — they auto-generate call summaries and suggest next steps. We adopt the AI prefill + human review pattern but reject auto-creation without review, as reps need control over what enters the CRM.

## Problem Statement

1. **Dead buttons**: The `schedule_followup` and `add_note` actions in ActionCard.tsx show "not connected to a workflow yet" — no value delivered post-call.
2. **Manual CRM entry**: After a call, reps must manually write notes and schedule follow-ups, duplicating effort when the transcript already contains the needed information.
3. **No call linkage**: Follow-up interactions created separately have no traceability back to the originating call activity.

## Proposed Solution

### High-Level Approach

```
Call ends → endSession()
  ├─ registerCallActivity()         [existing — creates call interaction]
  ├─ mergeCompanyContext()           [existing — updates company memory]
  ├─ generateQuickActionPrefill()   [NEW — Claude generates summary + follow-up suggestion]
  └─ emitSuggestion(finalQuickAction with prefill)
                                         │
                               User sees ActionCard
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
     "Create offer"          "Plan follow-up"              "Add note"
     (out of scope)          Opens FollowUpDialog          Opens NoteEditorPopup
                             ┌────────────────┐            ┌─────────────────┐
                             │ Title (edit)   │            │ Summary (edit)  │
                             │ Date (edit)    │            │                 │
                             │ Description    │            │ [Save] [Cancel] │
                             │ [Save][Cancel] │            └─────────────────┘
                             └────────────────┘                    │
                                    │                              ▼
                                    ▼                   customers.comments.create
                        customers.interactions.create          (CommandBus)
                               (CommandBus)
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Pre-compute AI prefill at call end | Eliminates UX latency on button click; LLM call piggybacks on existing `endSession()` flow |
| Dialog for follow-up, popup for note | Follow-up has multiple fields (date, title, description) requiring a form; note is single-field (body) requiring only a textarea |
| `interactionType: 'task'` for follow-ups (not `follow_up`) | Tasks appear in the **Tasks tab** of customer detail; `task` is the canonical type used by `TasksSection` with `useCanonicalInteractions=true` |
| Call linkage via `source` field (`voice_channels.copilot:{callId}`) | No core schema changes needed; `source` is an existing nullable text field on `CustomerInteraction`; queryable |
| Self-assigned to current rep | Simplest UX; delegation can be added later via interaction update |
| `CustomerComment` for notes (not `CustomerInteraction` with type `note`) | Comments are the canonical "note" entity in the CRM displayed in the **Notes tab**; interactions are for schedulable/trackable activities in Tasks/Activities |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| On-demand AI generation on button click | 2-5s latency on click; poor UX; user expects instant dialog |
| Auto-create without review | Reps need control over CRM data quality; AI summaries may contain errors |
| `interactionType: 'follow_up'` | Does not appear in Tasks tab; `TasksSection` filters by `interactionType=task` |
| `parentInteractionId` FK for call linkage | Requires core schema migration; `source` field achieves the same traceability without core changes |
| Store call link in `dealId` | Semantically wrong — `dealId` links to deals, not parent interactions |

## User Stories

- **Sales rep** wants to **schedule a follow-up with AI-suggested details after a call** so that **no action items are lost and CRM stays current without manual data entry**
- **Sales rep** wants to **save an AI-generated call summary as a CRM note** so that **the conversation context is preserved for the team without retyping**
- **Sales manager** wants to **see follow-up interactions linked to the originating call** so that **call-to-action conversion can be tracked**

## Architecture

### Package Placement

All new code lives in `packages/voice-channels/src/modules/voice_channels/` — the voice channels package owns the Copilot UI and orchestration. The only change to `packages/core` is the new `parent_interaction_id` column on `CustomerInteraction`.

### Commands Used

| Action | Command ID | Existing? |
|--------|-----------|-----------|
| Schedule follow-up | `customers.interactions.create` | Yes |
| Add note | `customers.comments.create` | Yes |

No new commands needed — both existing commands accept all required fields.

### Events Emitted (by existing commands)

| Event | Trigger |
|-------|---------|
| `customers.interaction.created` | Follow-up saved |
| `customers.comment.created` | Note saved |

### Data Flow: AI Prefill Generation

```
endSession(callId)
  │
  ├─ registerCallActivity() → returns callInteractionId
  │
  ├─ generateQuickActionPrefill(session, callInteractionId)
  │     │
  │     ├─ Build prompt with transcript + detected intents
  │     ├─ Call Claude API (claude-haiku-4-5-20251001)
  │     ├─ Parse structured JSON response:
  │     │     {
  │     │       "summary": "...",           // For add_note
  │     │       "followUp": {
  │     │         "title": "...",           // Suggested title
  │     │         "description": "...",     // Suggested description
  │     │         "suggestedDate": "..."    // ISO date string
  │     │       }
  │     │     }
  │     └─ Return prefill data (or fallback on failure)
  │
  └─ buildQuickAction(session, ...) with enriched prefill:
        actions: [
          { actionType: 'create_quote', prefill: { customerId } },
          { actionType: 'schedule_followup', prefill: {
              customerId, callInteractionId,
              title, description, suggestedDate
          }},
          { actionType: 'add_note', prefill: {
              customerId, callInteractionId, summary
          }},
        ]
```

### UI Component Tree

```
ActionCard
  ├─ Button "Plan follow-up" → onClick opens FollowUpDialog
  │     └─ FollowUpDialog (Dialog primitive)
  │           ├─ Input: title (prefilled)
  │           ├─ DatePicker: scheduledAt (prefilled)
  │           ├─ Textarea: description (prefilled)
  │           └─ Footer: [Cancel] [Save] (Cmd+Enter)
  │
  └─ Button "Add note" → onClick opens NoteEditorPopup
        └─ NoteEditorPopup (Dialog primitive)
              ├─ Textarea: body (prefilled with AI summary)
              └─ Footer: [Cancel] [Save] (Cmd+Enter)
```

Both dialogs follow the platform convention: `Cmd/Ctrl+Enter` to submit, `Escape` to cancel.

## Data Models

### No Database Changes

All operations use existing entities and schemas — no migrations needed.

- **Follow-up (Task)**: Created as `CustomerInteraction` with `interactionType: 'task'` — appears in the **Tasks tab**
- **Note**: Created as `CustomerComment` — appears in the **Notes tab**
- **Call linkage**: The `source` field on `CustomerInteraction` stores `voice_channels.copilot:{callId}` for traceability

### QuickActionCard Prefill Shape (TypeScript — no DB)

```typescript
// schedule_followup prefill
interface FollowUpPrefill {
  customerId: string | null
  callId: string                      // for source field traceability
  title: string                       // AI-suggested
  description: string                 // AI-suggested
  suggestedDate: string               // ISO 8601
}

// add_note prefill
interface NotePrefill {
  customerId: string | null
  callId: string                      // for reference
  summary: string                     // AI-generated conversation summary
}
```

### Existing Schemas Used (No Changes)

- **`interactionCreateSchema`**: Accepts `entityId`, `interactionType`, `title`, `body`, `status`, `scheduledAt`, `appearanceIcon`, `source` — all fields needed for task creation
- **`commentCreateSchema`**: Accepts `entityId`, `body`, `appearanceIcon` — all fields needed for note creation

## API Contracts

No new API routes needed. Both actions invoke existing commands client-side through the ActionCard component, which calls the CommandBus via `apiCall`:

### Schedule Follow-up (Task)

```
POST /api/customers/interactions
Content-Type: application/json

{
  "entityId": "<customerId>",
  "interactionType": "task",
  "title": "Follow-up: Discuss Q2 pricing proposal",
  "body": "AI-suggested: Customer expressed interest in volume discount...",
  "status": "planned",
  "scheduledAt": "2026-04-14T09:00:00Z",
  "appearanceIcon": "lucide:calendar-check",
  "source": "voice_channels.copilot:<callId>"
}

Response 201: { "interactionId": "uuid", "entityId": "uuid" }
```

### Add Note

```
POST /api/customers/comments
Content-Type: application/json

{
  "entityId": "<customerId>",
  "body": "Call summary (2026-04-11): Customer discussed Q2 steel order...",
  "authorUserId": "<repUserId>",
  "appearanceIcon": "lucide:message-square-text"
}

Response 201: { "commentId": "uuid", "authorUserId": "uuid" }
```

Both existing routes already export `openApi` specs.

## Internationalization (i18n)

New keys in `packages/voice-channels` locale files:

| Key | EN | PL |
|-----|----|----|
| `voice_channels.copilot.followUp.dialogTitle` | Plan follow-up | Zaplanuj follow-up |
| `voice_channels.copilot.followUp.titleLabel` | Title | Tytuł |
| `voice_channels.copilot.followUp.dateLabel` | Scheduled date | Data |
| `voice_channels.copilot.followUp.descriptionLabel` | Description | Opis |
| `voice_channels.copilot.followUp.save` | Save follow-up | Zapisz follow-up |
| `voice_channels.copilot.followUp.success` | Follow-up scheduled | Follow-up zaplanowany |
| `voice_channels.copilot.note.dialogTitle` | Add note | Dodaj notatkę |
| `voice_channels.copilot.note.bodyLabel` | Note content | Treść notatki |
| `voice_channels.copilot.note.save` | Save note | Zapisz notatkę |
| `voice_channels.copilot.note.success` | Note saved | Notatka zapisana |
| `voice_channels.copilot.prefill.failed` | Could not generate suggestions | Nie udało się wygenerować sugestii |

## UI/UX

### FollowUpDialog

- Opens as a centered modal (Dialog primitive from `@open-mercato/ui/primitives/dialog`)
- Fields: Title (text input), Scheduled date (date picker), Description (textarea, 4 rows)
- All fields pre-filled with AI suggestions, fully editable
- Footer: Cancel (ghost) + Save follow-up (primary, green accent)
- `Cmd/Ctrl+Enter` submits, `Escape` cancels
- On success: flash "Follow-up scheduled", dismiss the QuickActionCard
- On error: flash error message, keep dialog open

### NoteEditorPopup

- Opens as a centered modal (Dialog primitive)
- Single field: textarea (6 rows) pre-filled with AI-generated summary
- Footer: Cancel (ghost) + Save note (primary)
- `Cmd/Ctrl+Enter` submits, `Escape` cancels
- On success: flash "Note saved", dismiss the QuickActionCard
- On error: flash error message, keep dialog open

### Fallback UX (AI generation failed)

If `generateQuickActionPrefill()` fails:
- Follow-up dialog opens with empty fields (rep fills manually)
- Note editor opens with a raw transcript excerpt (first 500 chars) as placeholder
- A subtle info flash: "Could not generate suggestions"

## Implementation Plan

### Phase 1: AI Prefill Generation

1. Create `packages/voice-channels/src/modules/voice_channels/lib/copilot/generate-quick-action-prefill.ts`:
   - Export `generateQuickActionPrefill(session: CopilotSession, callInteractionId: string | null): Promise<QuickActionPrefillResult>`
   - Call Claude API (haiku) with transcript + intents prompt
   - Parse structured JSON response with zod
   - Return typed prefill data or fallback defaults
2. Update `endSession()` in `orchestrator.ts`:
   - Capture `callInteractionId` from `registerCallActivity()` return value
   - Call `generateQuickActionPrefill()` after activity registration
   - Pass prefill data to `buildQuickAction()`
3. Update `buildQuickAction()` to accept and embed prefill data in each action's `prefill` field
4. Update `QuickActionCard` type to add typed prefill interfaces (or keep `Record<string, unknown>` with runtime validation on consumer side)

### Phase 2: UI — FollowUpDialog & NoteEditorPopup

1. Create `packages/voice-channels/src/modules/voice_channels/components/copilot/cards/FollowUpDialog.tsx`:
   - Dialog with title input, date picker, description textarea
   - Accept prefill props, call `apiCall` to `POST /api/customers/interactions`
   - Handle success/error with flash messages
2. Create `packages/voice-channels/src/modules/voice_channels/components/copilot/cards/NoteEditorPopup.tsx`:
   - Dialog with textarea
   - Accept prefill props, call `apiCall` to `POST /api/customers/comments`
   - Handle success/error with flash messages
3. Update `ActionCard.tsx`:
   - Replace flash-only `handleAction()` with action-specific handlers
   - Pass `action.prefill` to dialog/popup components
   - Manage open/close state for each dialog
   - On successful save, call `onDismiss()` to remove the card
4. Add i18n keys to voice_channels locale files
5. Verify Cmd+Enter / Escape behavior in both dialogs

### Phase 3: Integration Testing

1. Test AI prefill generation with mock transcript
2. Test follow-up creation flow end-to-end (dialog → command → interaction appears in Activities)
3. Test note creation flow end-to-end (popup → command → comment appears in Notes)
4. Test fallback when AI generation fails (empty prefill, raw transcript)
5. Test `parentInteractionId` linkage — verify follow-up references the call activity
6. Test undo of follow-up and note via action log

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/voice-channels/.../lib/copilot/generate-quick-action-prefill.ts` | Create | AI prefill generation via Claude API |
| `packages/voice-channels/.../lib/copilot/orchestrator.ts` | Modify | Integrate prefill generation into `endSession()` |
| `packages/voice-channels/.../components/copilot/cards/FollowUpDialog.tsx` | Create | Follow-up scheduling dialog |
| `packages/voice-channels/.../components/copilot/cards/NoteEditorPopup.tsx` | Create | Note editor popup |
| `packages/voice-channels/.../components/copilot/cards/ActionCard.tsx` | Modify | Wire buttons to dialogs |
| `packages/voice-channels/.../types.ts` | Modify | Add typed prefill interfaces (optional) |
| Voice channels locale files | Modify | Add i18n keys |

## Risks & Impact Review

### Data Integrity Failures

- **Interrupted save**: Both commands run in ORM transactions — partial writes cannot occur. If the API call fails, the dialog stays open and the user can retry.
- **Dangling `parentInteractionId`**: FK uses `ON DELETE SET NULL` — if the parent call activity is deleted (or undone), the follow-up loses the link but is not deleted.
- **Race condition**: Two reps cannot act on the same QuickActionCard (it's scoped to the rep's Copilot session). No concurrency risk.

### Cascading Failures & Side Effects

- **Event subscribers**: `customers.interaction.created` and `customers.comment.created` already have stable subscriber chains. Adding a follow-up or note is identical to manual creation — no new failure paths.
- **AI generation failure**: Best-effort with graceful fallback. Does not block the QuickActionCard emission or the call activity registration.

### Tenant & Data Isolation Risks

- All operations flow through the existing CommandBus which enforces `organization_id` scoping. The `parentInteractionId` FK is within the same table, so cross-tenant linking is impossible (parent and child share the same `organization_id` constraint).

### Migration & Deployment Risks

- **Additive-only migration**: Single nullable column + partial index. No data backfill. Zero downtime deployment.
- **No breaking API changes**: `parentInteractionId` is optional in the schema (`.passthrough()` already allows extra fields).

### Operational Risks

- **Claude API rate limits**: The prefill generation adds one additional Claude API call per call end. With haiku model and max ~200 output tokens, this is negligible.
- **Storage**: One additional interaction + one comment per call is marginal growth.

### Risk Register

#### AI Prefill Unavailable
- **Scenario**: Claude API key missing, rate limited, or returns malformed JSON
- **Severity**: Low
- **Affected area**: QuickActionCard prefill quality — buttons still work, just with empty/fallback data
- **Mitigation**: Try/catch with fallback to empty prefill; info flash to user
- **Residual risk**: Rep must type manually — acceptable degradation

#### Parent Interaction Deleted After Follow-up Created
- **Scenario**: Rep undoes the call activity after creating a follow-up linked to it
- **Severity**: Low
- **Affected area**: `parentInteractionId` becomes NULL on the follow-up
- **Mitigation**: `ON DELETE SET NULL` FK constraint; UI should handle null parent gracefully
- **Residual risk**: Traceability lost for that specific follow-up — acceptable

## Final Compliance Report — 2026-04-11

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `parent_interaction_id` is self-referential FK within `customer_interactions` table, not cross-module |
| root AGENTS.md | Filter by `organization_id` | Compliant | All operations go through existing tenant-scoped CommandBus commands |
| root AGENTS.md | Validate all inputs with zod | Compliant | `parentInteractionId` added to existing zod schemas |
| root AGENTS.md | Use CommandBus for mutations | Compliant | Uses `customers.interactions.create` and `customers.comments.create` |
| root AGENTS.md | i18n: never hard-code user-facing strings | Compliant | All new strings use `useT()` with locale keys |
| root AGENTS.md | Every dialog: Cmd+Enter submit, Escape cancel | Compliant | Both dialogs implement this convention |
| root AGENTS.md | Never hand-write migrations | Compliant | Uses `yarn db:generate` |
| root AGENTS.md | Use `apiCall` — never raw `fetch` | Compliant | UI components use `apiCall` for HTTP calls |
| packages/core/AGENTS.md | Commands define undo behavior | Compliant | Existing commands already handle undo; `parentInteractionId` included in snapshots |
| packages/ui/AGENTS.md | Use Dialog primitive for modals | Compliant | Both dialogs use `@open-mercato/ui/primitives/dialog` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `parentInteractionId` in entity, schema, and API payload |
| API contracts match UI/UX section | Pass | Dialog fields map 1:1 to API request body |
| Risks cover all write operations | Pass | Both create operations + AI generation covered |
| Commands defined for all mutations | Pass | Uses two existing commands, no new commands needed |
| Cache strategy covers all read APIs | N/A | No new read APIs; existing cache invalidation via CommandBus |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — ready for implementation.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — AI Prefill Generation | Done | 2026-04-11 | `generate-quick-action-prefill.ts` created; orchestrator updated to pre-compute at call end |
| Phase 2 — UI (FollowUpDialog & NoteEditorPopup) | Done | 2026-04-11 | Both dialogs created with Cmd+Enter/Escape; ActionCard wired; i18n keys added (EN/PL/DE/ES) |
| Phase 3 — Integration Testing | In Progress | 2026-04-11 | Added targeted regression tests for dialog submissions and malformed summarize request bodies; broader end-to-end coverage still pending |

### Phase 1 — Detailed Progress
- [x] Create `generate-quick-action-prefill.ts` with Claude API call + fallback
- [x] Update `endSession()` to call prefill generation after `registerCallActivity()`
- [x] Update `buildQuickAction()` to accept and embed prefill data

### Phase 2 — Detailed Progress
- [x] Create `FollowUpDialog.tsx` — creates **Task** (`interactionType: 'task'`) in Tasks tab
- [x] Create `NoteEditorPopup.tsx` — creates **Comment** in Notes tab
- [x] Update `ActionCard.tsx` to open dialogs on button click
- [x] Add i18n keys to all 4 locale files (EN, PL, DE, ES)
- [x] Fix: follow-up uses `interactionType: 'task'` (not `follow_up`) so it appears in Tasks tab
- [x] Fix: call linkage via `source: 'voice_channels.copilot:{callId}'` instead of `parentInteractionId`

## Changelog
### 2026-04-11
- Initial skeleton with open questions
- Resolved Q1-Q5: pre-compute at call end, dialog for follow-up, popup for note, `parentInteractionId` FK, self-assigned
- Full specification written with 4-phase implementation plan
- Implemented Phases 1-2 (voice-channels only, no core modifications)
- Corrected: follow-up creates `interactionType: 'task'` (Tasks tab), not `follow_up`
- Corrected: call linkage via `source` field, removed `parentInteractionId` (no core changes needed)
- Removed Phase 1 (Data Model) — no database migrations required
- Fixed post-review regressions: canonical follow-up writes now use `/api/customers/interactions` with `source: voice_channels.copilot:{callId}`, both dialogs use guarded mutations, multi-entity writes roll back on partial failure, and summarize route rejects malformed JSON with `400`
