'use client'

import { useCallback, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import type { MockCallScript } from '../../../types'
import { DEMO_1_ACME_STEEL } from '../../../data/demo-scripts/demo-1-acme-steel'
import { CopilotWorkspace } from '../../../components/copilot/CopilotWorkspace'

const demoScript: MockCallScript = DEMO_1_ACME_STEEL

export default function CopilotHarnessPage() {
  const t = useT()
  const [isRunning, setIsRunning] = useState(false)
  const [busy, setBusy] = useState(false)

  const startCall = useCallback(async () => {
    if (busy || isRunning) return
    setBusy(true)
    try {
      await apiCallOrThrow('/api/voice_channels/mock/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: demoScript }),
      })
      setIsRunning(true)
      flash(
        t(
          'voice_channels.copilot.harness.messages.started',
          'Demo replay started for the Copilot QA harness.',
        ),
        'info',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start demo call.'
      flash(message, 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, isRunning, t])

  const stopCall = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await apiCallOrThrow('/api/voice_channels/mock/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: demoScript.callId }),
      })
      flash(
        t('voice_channels.copilot.harness.messages.stopped', 'Demo replay stopped.'),
        'info',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop demo call.'
      flash(message, 'error')
    } finally {
      setIsRunning(false)
      setBusy(false)
    }
  }, [busy, t])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={startCall} disabled={busy || isRunning}>
            {t('voice_channels.copilot.harness.startReplay', 'Start replay')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={stopCall}
            disabled={busy || !isRunning}
          >
            {t('voice_channels.copilot.harness.stopReplay', 'Stop replay')}
          </Button>
          <div className="flex flex-col text-sm text-muted-foreground">
            <span>
              {t(
                'voice_channels.copilot.harness.notice',
                'QA harness only. The main Copilot UI remains event-driven and provider-agnostic.',
              )}
            </span>
            <span>
              Script customer:{' '}
              <code className="font-mono">{demoScript.customerId}</code> (from
              demo-1-acme-steel.json)
            </span>
          </div>
        </div>
      </div>

      <CopilotWorkspace />
    </div>
  )
}
