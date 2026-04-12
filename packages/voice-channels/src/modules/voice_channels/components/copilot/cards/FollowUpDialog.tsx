'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefill: Record<string, unknown>
  onSuccess: () => void
}

function resolveTargetEntityIds(prefill: Record<string, unknown>): string[] {
  if (Array.isArray(prefill.targetEntityIds)) {
    return Array.from(
      new Set(
        prefill.targetEntityIds.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        ),
      ),
    )
  }

  const fallbackEntityId =
    typeof prefill.targetEntityId === 'string'
      ? prefill.targetEntityId
      : typeof prefill.customerId === 'string'
        ? prefill.customerId
        : null

  return fallbackEntityId ? [fallbackEntityId] : []
}

type InteractionCreateResult = {
  id?: string | null
  interactionId?: string | null
}

async function rollbackInteractions(interactionIds: string[]): Promise<void> {
  for (const interactionId of [...interactionIds].reverse()) {
    const rollback = await apiCall(`/api/customers/interactions?id=${encodeURIComponent(interactionId)}`, {
      method: 'DELETE',
    })
    if (!rollback.ok) {
      throw new Error('interaction-rollback-failed')
    }
  }
}

export function FollowUpDialog({ open, onOpenChange, prefill, onSuccess }: Props) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const callId = typeof prefill.callId === 'string' && prefill.callId.length > 0 ? prefill.callId : 'pending'
  const mutationContextId = useMemo(() => `voice-channels:copilot:follow-up:${callId}`, [callId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    data: null
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = useMemo(
    () => ({
      formId: mutationContextId,
      data: null,
      retryLastMutation,
    }),
    [mutationContextId, retryLastMutation],
  )

  useEffect(() => {
    if (open) {
      setTitle(typeof prefill.title === 'string' ? prefill.title : '')
      setDescription(typeof prefill.description === 'string' ? prefill.description : '')
      const suggestedDate = typeof prefill.suggestedDate === 'string' ? prefill.suggestedDate : ''
      if (suggestedDate) {
        // Convert ISO to datetime-local format: YYYY-MM-DDTHH:mm
        setScheduledAt(suggestedDate.slice(0, 16))
      } else {
        setScheduledAt('')
      }
    }
  }, [open, prefill])

  const handleSubmit = useCallback(async () => {
    const targetEntityIds = resolveTargetEntityIds(prefill)
    const ownerUserId = typeof prefill.ownerUserId === 'string' ? prefill.ownerUserId : null
    const callSource =
      typeof prefill.callId === 'string' && prefill.callId.trim().length > 0
        ? `voice_channels.copilot:${prefill.callId.trim()}`
        : null
    if (targetEntityIds.length === 0) {
      flash(t('voice_channels.copilot.followUp.noCustomer', 'No customer linked to this call.'), 'error')
      return
    }

    setIsSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const createdInteractionIds: string[] = []

          try {
            for (const entityId of targetEntityIds) {
              const response = await apiCall<InteractionCreateResult>('/api/customers/interactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  entityId,
                  interactionType: 'task',
                  title:
                    title.trim() ||
                    t('voice_channels.copilot.followUp.defaultTitle', 'Follow-up after call'),
                  body: description.trim() || null,
                  status: 'planned',
                  scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
                  ownerUserId,
                  appearanceIcon: 'lucide:calendar-check',
                  source: callSource,
                }),
              })

              const createdInteractionId =
                typeof response.result?.interactionId === 'string'
                  ? response.result.interactionId
                  : typeof response.result?.id === 'string'
                    ? response.result.id
                    : null

              if (!response.ok || !createdInteractionId) {
                throw new Error('interaction-create-failed')
              }

              createdInteractionIds.push(createdInteractionId)
            }
          } catch (error) {
            if (createdInteractionIds.length > 0) {
              await rollbackInteractions(createdInteractionIds)
            }
            throw error
          }
        },
        mutationPayload: {
          actionType: 'schedule_followup',
          targetEntityIds,
          callId: typeof prefill.callId === 'string' ? prefill.callId : null,
        },
        context: mutationContext,
      })

      flash(t('voice_channels.copilot.followUp.success', 'Follow-up scheduled'), 'success')
      onOpenChange(false)
      onSuccess()
    } catch {
      flash(t('voice_channels.copilot.followUp.error', 'Failed to schedule follow-up'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [description, mutationContext, onOpenChange, onSuccess, prefill, runMutation, scheduledAt, t, title])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t('voice_channels.copilot.followUp.dialogTitle', 'Plan follow-up')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'voice_channels.copilot.followUp.dialogDescription',
              'Review and save the follow-up task suggested from this call.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="followup-title">
              {t('voice_channels.copilot.followUp.titleLabel', 'Title')}
            </Label>
            <Input
              id="followup-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('voice_channels.copilot.followUp.titlePlaceholder', 'e.g. Discuss pricing proposal')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="followup-date">
              {t('voice_channels.copilot.followUp.dateLabel', 'Scheduled date')}
            </Label>
            <Input
              id="followup-date"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="followup-description">
              {t('voice_channels.copilot.followUp.descriptionLabel', 'Description')}
            </Label>
            <Textarea
              id="followup-description"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('voice_channels.copilot.followUp.descriptionPlaceholder', 'What should be discussed...')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('voice_channels.copilot.followUp.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting
              ? t('voice_channels.copilot.followUp.saving', 'Saving...')
              : t('voice_channels.copilot.followUp.save', 'Save follow-up')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
