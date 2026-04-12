'use client'

import { useCallback, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import type { QuickActionCard, TranscriptSegment } from '../../../types'
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
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const keepVisible = useCallback(() => undefined, [])

  const followUpAction = card.actions.find((a) => a.actionType === 'schedule_followup')
  const noteAction = card.actions.find((a) => a.actionType === 'add_note')

  const handleAction = useCallback(
    (actionType: string) => {
      switch (actionType) {
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
              onClick={() => handleAction(action.actionType)}
              variant="outline"
              size="sm"
              className={cn(
                'h-auto rounded-md border px-3 py-1.5 text-xs font-semibold shadow-none',
                ACTION_BUTTON_CLASSES[action.actionType],
              )}
            >
              {action.label}
            </Button>
          ))}
        </div>
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
