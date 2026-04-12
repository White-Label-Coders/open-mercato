import { asValue, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CopilotOrchestrator } from './lib/copilot/orchestrator'
import { MockTranscriptSimulator } from './lib/mock/simulator'
import { IntentDetector } from './lib/copilot/intent-detector'
import { createLlmClient } from './lib/copilot/llmClient'

export function register(container: AppContainer) {
  const llmClient = createLlmClient({
    provider: (process.env.LLM_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai' | 'google',
    apiKey: process.env.LLM_API_KEY
      ?? process.env.ANTHROPIC_API_KEY
      ?? process.env.OPENAI_API_KEY
      ?? process.env.GOOGLE_API_KEY
      ?? '',
    model: process.env.LLM_MODEL ?? undefined,
    apiUrl: process.env.LLM_API_URL ?? undefined,
    timeoutMs: process.env.LLM_TIMEOUT_MS
      ? parseInt(process.env.LLM_TIMEOUT_MS, 10)
      : undefined,
  })

  container.register({
    llmClient: asValue(llmClient),
    copilotOrchestrator: asFunction(() => new CopilotOrchestrator(container)).singleton(),
    mockTranscriptSimulator: asFunction(() => new MockTranscriptSimulator(container)).singleton(),
    intentDetector: asFunction(() => new IntentDetector(container)).singleton(),
  })
}
