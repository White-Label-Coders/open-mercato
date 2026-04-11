'use client'

import { useCallback, useState } from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import type { MockCallScript } from '../../../types'
import { DEMO_1_ACME_STEEL } from '../../../data/demo-scripts/demo-1-acme-steel'
import { CopilotWorkspace } from '../../../components/copilot/CopilotWorkspace'

const demoScript: MockCallScript = DEMO_1_ACME_STEEL

export default function CopilotHarnessPage() {
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
      flash('Demo call started — suggestions will stream from the orchestrator.', 'info')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start demo call.'
      flash(message, 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, isRunning])

  const stopCall = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await apiCallOrThrow('/api/voice_channels/mock/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: demoScript.callId }),
      })
      flash('Demo call stopped.', 'info')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop demo call.'
      flash(message, 'error')
    } finally {
      setIsRunning(false)
      setBusy(false)
    }
  }, [busy])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={startCall} disabled={busy || isRunning}>
            Start Demo Call
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={stopCall}
            disabled={busy || !isRunning}
          >
            Stop Demo Call
          </Button>
          <div className="flex flex-col text-sm text-muted-foreground">
            <span>
              QA harness — POSTs the demo script to{' '}
              <code className="font-mono">/api/voice_channels/mock/start</code>; transcript
              segments and suggestions stream in via the event bridge from the real
              orchestrator.
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
