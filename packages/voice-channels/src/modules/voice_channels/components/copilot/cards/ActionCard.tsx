'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { flash, useNotify } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { QuickActionCard, VoiceCreateQuotePrefill } from '../../../types'

interface Props {
  card: QuickActionCard
  onDismiss: () => void
}

export function ActionCard({ card, onDismiss }: Props) {
  const router = useRouter()
  const notify = useNotify()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `voice-copilot-quick-action-${card.id}`,
  })
  const [pendingActionType, setPendingActionType] = useState<string | null>(null)

  const canExecuteQuoteAction = (prefill?: Record<string, unknown>) => {
    if (!prefill) return false
    const customerId = typeof prefill.customerId === 'string' ? prefill.customerId : null
    const lines = Array.isArray(prefill.lines) ? prefill.lines : []
    return Boolean(customerId) && lines.length > 0
  }

  const handleAction = async (actionType: string, rawPrefill?: Record<string, unknown>) => {
    if (pendingActionType) return

    if (actionType !== 'create_quote') {
      flash(`Akcja ${actionType} nie jest jeszcze podłączona do workflow.`, 'info')
      return
    }

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

    setPendingActionType(actionType)

    try {
      const result = await runMutation<{
        quoteId: string
        redirectTo: string
      }>({
        operation: () =>
          readApiResultOrThrow<{ quoteId: string; redirectTo: string }>(
            '/api/voice_channels/copilot/quick-actions/create-quote',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                actionType,
                prefill,
              }),
            },
            {
              errorMessage: 'Nie udało się utworzyć oferty z rozmowy.',
            },
          ),
        context: {
          suggestionId: card.id,
          actionType,
          callId: prefill.source.callId,
        },
        mutationPayload: {
          suggestionId: card.id,
          actionType,
          callId: prefill.source.callId,
        },
      })

      notify({
        message: 'Oferta została utworzona na podstawie rozmowy.',
        type: 'success',
        action: {
          label: 'Otwórz ofertę',
          onClick: () => {
            router.push(result.redirectTo)
          },
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nie udało się utworzyć oferty z rozmowy.'
      flash(message, 'error')
    } finally {
      setPendingActionType(null)
    }
  }

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #22c55e',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#f0fdf4',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#166534' }}>⚡ Szybkie akcje</span>
        <IconButton type="button" variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss quick actions">
          ✕
        </IconButton>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        &ldquo;{card.triggerText}&rdquo;
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {card.actions.map((action, i) => (
          <Button
            key={i}
            type="button"
            onClick={() => void handleAction(action.actionType, action.prefill)}
            variant="outline"
            size="sm"
            className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            disabled={
              pendingActionType !== null ||
              (action.actionType === 'create_quote' && !canExecuteQuoteAction(action.prefill))
            }
          >
            {pendingActionType === action.actionType ? 'Tworzenie...' : action.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
