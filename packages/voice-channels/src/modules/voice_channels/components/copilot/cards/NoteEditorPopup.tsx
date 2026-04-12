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
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { TranscriptSegment } from '../../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefill: Record<string, unknown>
  segments: TranscriptSegment[]
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

  return typeof prefill.customerId === 'string' ? [prefill.customerId] : []
}

type CommentCreateResult = {
  id?: string | null
}

async function rollbackComments(commentIds: string[]): Promise<void> {
  for (const commentId of [...commentIds].reverse()) {
    const rollback = await apiCall(`/api/customers/comments?id=${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    })
    if (!rollback.ok) {
      throw new Error('comment-rollback-failed')
    }
  }
}

export function NoteEditorPopup({ open, onOpenChange, prefill, segments, onSuccess }: Props) {
  const t = useT()
  const [body, setBody] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const callId = typeof prefill.callId === 'string' && prefill.callId.length > 0 ? prefill.callId : 'pending'
  const mutationContextId = useMemo(() => `voice-channels:copilot:note:${callId}`, [callId])
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
    if (!open) return

    const aiSummary = typeof prefill.summary === 'string' && prefill.summary.length > 0
      ? prefill.summary
      : null

    if (aiSummary) {
      setBody(aiSummary)
      return
    }

    if (segments.length === 0) {
      setBody('')
      return
    }

    setIsSummarizing(true)
    setBody('')

    apiCall<{ summary: string }>('/api/voice_channels/copilot/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: segments.map((s) => ({ speaker: s.speaker, text: s.text })),
      }),
    })
      .then((response) => {
        const summary = response.result?.summary
        if (typeof summary === 'string' && summary.length > 0) {
          setBody(summary)
        } else {
          setBody(
            segments
              .map((s) => `[${s.speaker === 'rep' ? 'Rep' : 'Customer'}] ${s.text}`)
              .join('\n')
              .slice(0, 5000),
          )
        }
      })
      .catch(() => {
        setBody(
          segments
            .map((s) => `[${s.speaker === 'rep' ? 'Rep' : 'Customer'}] ${s.text}`)
            .join('\n')
            .slice(0, 5000),
        )
      })
      .finally(() => {
        setIsSummarizing(false)
      })
  }, [open, prefill, segments])

  const handleSubmit = useCallback(async () => {
    const targetEntityIds = resolveTargetEntityIds(prefill)
    if (targetEntityIds.length === 0) {
      flash(t('voice_channels.copilot.note.noCustomer', 'No customer linked to this call.'), 'error')
      return
    }

    if (!body.trim()) {
      flash(t('voice_channels.copilot.note.emptyBody', 'Note content cannot be empty.'), 'error')
      return
    }

    setIsSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const createdCommentIds: string[] = []

          try {
            for (const entityId of targetEntityIds) {
              const response = await apiCall<CommentCreateResult>('/api/customers/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  entityId,
                  body: body.trim(),
                  appearanceIcon: 'lucide:message-square-text',
                }),
              })

              if (!response.ok || typeof response.result?.id !== 'string') {
                throw new Error('comment-create-failed')
              }

              createdCommentIds.push(response.result.id)
            }
          } catch (error) {
            if (createdCommentIds.length > 0) {
              await rollbackComments(createdCommentIds)
            }
            throw error
          }
        },
        mutationPayload: {
          actionType: 'add_note',
          targetEntityIds,
          callId: typeof prefill.callId === 'string' ? prefill.callId : null,
        },
        context: mutationContext,
      })

      flash(t('voice_channels.copilot.note.success', 'Note saved'), 'success')
      onOpenChange(false)
      onSuccess()
    } catch {
      flash(t('voice_channels.copilot.note.error', 'Failed to save note'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [body, mutationContext, onOpenChange, onSuccess, prefill, runMutation, t])

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
            {t('voice_channels.copilot.note.dialogTitle', 'Add note')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'voice_channels.copilot.note.dialogDescription',
              'Review and save the note generated from this call.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note-body">
              {t('voice_channels.copilot.note.bodyLabel', 'Note content')}
            </Label>
            {isSummarizing ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {t('voice_channels.copilot.note.summarizing', 'Generating conversation summary...')}
              </div>
            ) : (
              <Textarea
                id="note-body"
                rows={6}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t('voice_channels.copilot.note.bodyPlaceholder', 'Conversation summary...')}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('voice_channels.copilot.note.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting || isSummarizing}>
            {isSubmitting
              ? t('voice_channels.copilot.note.saving', 'Saving...')
              : t('voice_channels.copilot.note.save', 'Save note')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
