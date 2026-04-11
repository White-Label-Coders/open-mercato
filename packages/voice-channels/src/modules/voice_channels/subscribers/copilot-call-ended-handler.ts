import type { EventPayload } from '@open-mercato/shared/modules/events'
import type { CallEndEventPayload } from '@open-mercato/voice-channels/modules/voice_channels/types'

export const metadata = {
  event: 'voice_channels.call.ended',
  // Ephemeral on purpose: the LLM merge + custom-field write is best-effort.
  // Persistent retries would re-run the LLM call and risk duplicate / divergent
  // writes against the company context document.
  persistent: false,
  id: 'voice_channels.copilot.call-ended-handler',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(
  payload: EventPayload & CallEndEventPayload,
  ctx: ResolverContext,
) {
  const orchestrator = ctx.resolve<any>('copilotOrchestrator')
  await orchestrator.endSession(payload.callId)
}
