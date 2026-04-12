'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { flash, useNotify } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import type { QuickActionCard, TranscriptSegment, VoiceCreateQuotePrefill } from '../../../types'
import { CopilotCardFrame } from './CopilotCardFrame'
import { FollowUpDialog } from './FollowUpDialog'
import { NoteEditorPopup } from './NoteEditorPopup'

interface Props {
  card: QuickActionCard
  segments: TranscriptSegment[]
  onDismiss: () => void
}

const ACTION_BUTTON_CLASSES: Record<QuickActionCard['actions'][number]['actionType'], string> = {
  create_quote: 'border-blue-500/40 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25 hover:text-blue-200',
  schedule_followup:
    'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 hover:text-emerald-200',
  add_note: 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 hover:text-amber-200',
}

export function ActionCard({ card, segments, onDismiss }: Props) {
  const t = useT()
  const router = useRouter()
  const notify = useNotify()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `voice-copilot-quick-action-${card.id}`,
  })
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [pendingActionType, setPendingActionType] = useState<string | null>(null)
  const keepVisible = useCallback(() => undefined, [])

  const followUpAction = card.actions.find((a) => a.actionType === 'schedule_followup')
  const noteAction = card.actions.find((a) => a.actionType === 'add_note')

  const canExecuteQuoteAction = (prefill?: Record<string, unknown>) => {
    if (!prefill) return false
    const customerId = typeof prefill.customerId === 'string' ? prefill.customerId : null
    const lines = Array.isArray(prefill.lines) ? prefill.lines : []
    return Boolean(customerId) && lines.length > 0
  }

  const handleQuoteAction = async (rawPrefill?: Record<string, unknown>) => {
    if (pendingActionType) return
    if (!canExecuteQuoteAction(rawPrefill)) {
      flash('Brakuje danych z rozmowy do utworzenia oferty.', 'error')
      return
    }

    const prefill = {
      ...(rawPrefill ?? {}),
      source: {
        ...(typeof rawPrefill?.source === 'object' && rawPrefill?.source !== null ? rawPrefill.source as Record<string, unknown> : {}),
        suggestionId: card.id,
        callId:
          typeof rawPrefill?.source === 'object' &&
          rawPrefill?.source !== null &&
          typeof (rawPrefill.source as Record<string, unknown>).callId === 'string'
            ? (rawPrefill.source as Record<string, unknown>).callId
            : `copilot-${card.id}`,
        triggerSegmentId: card.triggerSegmentId,
      },
      transcriptSummary:
        typeof rawPrefill?.transcriptSummary === 'string' && rawPrefill.transcriptSummary.trim().length > 0
          ? rawPrefill.transcriptSummary
          : card.triggerText,
      note:
        typeof rawPrefill?.note === 'string' && rawPrefill.note.trim().length > 0
          ? rawPrefill.note
          : card.triggerText,
    } as VoiceCreateQuotePrefill

    setPendingActionType('create_quote')
    try {
      const result = await runMutation<{ quoteId: string; redirectTo: string }>({
        operation: () =>
          readApiResultOrThrow<{ quoteId: string; redirectTo: string }>(
            '/api/voice_channels/copilot/quick-actions/create-quote',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ actionType: 'create_quote', prefill }),
            },
            { errorMessage: 'Nie udało się utworzyć oferty z rozmowy.' },
          ),
        context: { suggestionId: card.id, actionType: 'create_quote', callId: prefill.source.callId },
        mutationPayload: { suggestionId: card.id, actionType: 'create_quote', callId: prefill.source.callId },
      })
      notify({
        message: 'Oferta została utworzona na podstawie rozmowy.',
        type: 'success',
        action: { label: 'Otwórz ofertę', onClick: () => router.push(result.redirectTo) },
      })
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Nie udało się utworzyć oferty z rozmowy.', 'error')
    } finally {
      setPendingActionType(null)
    }
  }

  const handleAction = useCallback(
    (actionType: string, prefill?: Record<string, unknown>) => {
      switch (actionType) {
        case 'create_quote':
          void handleQuoteAction(prefill)
          break
        case 'schedule_followup':
          setFollowUpOpen(true)
          break
        case 'add_note':
          setNoteOpen(true)
          break
        default:
          flash(
            t(
              'voice_channels.copilot.cards.quickActions.notConnected',
              'Action {actionType} is not connected to a workflow yet.',
              { actionType },
            ),
            'info',
          )
      }
    },
    [t],
  )

  return (
    <>
      <CopilotCardFrame
        tone="emerald"
        title={t('voice_channels.copilot.cards.quickActions.title', 'Quick actions')}
        icon="⚡"
        triggerText={card.triggerText}
        onDismiss={onDismiss}
        dismissLabel={t('voice_channels.copilot.cards.dismiss.quickActions', 'Dismiss quick actions')}
      >
        <div className="flex flex-wrap gap-2">
          {card.actions.map((action, i) => (
            <Button
              key={i}
              type="button"
              onClick={() => handleAction(action.actionType, action.prefill)}
              variant="outline"
              size="sm"
              className={cn(
                'h-auto rounded-md border px-3 py-1.5 text-xs font-semibold shadow-none',
                ACTION_BUTTON_CLASSES[action.actionType],
              )}
              disabled={
                pendingActionType !== null ||
                (action.actionType === 'create_quote' && !canExecuteQuoteAction(action.prefill))
              }
            >
              {pendingActionType === action.actionType ? 'Tworzenie...' : action.label}
            </Button>
          ))}
        </div>
        {card.actions.some((action) => action.prefill?.extractionMethod === 'heuristic_fallback') && (
          <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
            ⚠ Pozycje mogą wymagać korekty (AI niedostępne)
          </div>
        )}
      </CopilotCardFrame>

      <FollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        prefill={followUpAction?.prefill ?? {}}
        onSuccess={keepVisible}
      />
      <NoteEditorPopup
        open={noteOpen}
        onOpenChange={setNoteOpen}
        prefill={noteAction?.prefill ?? {}}
        segments={segments}
        onSuccess={keepVisible}
      />
    </>
  )
}
